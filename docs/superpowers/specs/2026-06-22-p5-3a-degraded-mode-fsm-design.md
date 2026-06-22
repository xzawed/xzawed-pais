# P5-3a — 강등 모드 FSM 코어 + ModeController (observe-only)

**날짜**: 2026-06-22
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/senario/OPERATIONS_DECISIONS.md` §1(강등 모드 NORMAL/DEGRADED/SAFE) · senario §13/§17 · N2(DEGRADED HIGH-risk 사인오프)
**선행 슬라이스**: §13 budget 서킷(#283) · provider 서킷(#284) · G1 서킷 decompose/advisory 배선(#325) · B1 `IntervalSweeper` 베이스(#322)

## 배경

OPERATIONS_DECISIONS §1은 운영 강등 모드를 확정한다: **NORMAL / DEGRADED / SAFE** 3상태, 신호 구동 전이, 상향 복귀 히스테리시스(플래핑 방지), 무음 통과 금지(M8). 현재 budget/provider 서킷이 트립해도 그 신호를 **운영 모드로 집계·추적하는 주체가 없다**(서킷은 개별 호출만 막을 뿐). 재감사 post-#312가 지목한 P5-3 잔여.

P5-3(로드맵)은 FSM + saga 보상 + canary/롤백을 묶으나 너무 크다. 본 슬라이스 **P5-3a**는 **FSM 코어 + ModeController(관측 전용)**만 — 모드를 추적·관측(로그)하고 `getMode()`로 노출하되 **enforcement는 하지 않는다**(SAFE 디스패치 보류·DEGRADED 사인오프는 P5-3b 후속). saga(P5-4)·canary(P5-5)는 별도.

## 범위 결정 (브레인스토밍 확정)

- **코어 + 관측만**: 순수 FSM + 신호 구동 모드 추적 + 전이 로그(M8) + `getMode()` 노출. **enforcement 0**(동작 불변). 가장 작은 blast radius·foundation.
- **신호원 슬라이스1 = 2개**: `providerCircuitOpen`(→DEGRADED)·`budgetDailyTripped`(→SAFE). 나머지 §1 신호(브로커·Supervisor 하트비트·이벤트스토어 쓰기실패·보안사고·지연)는 `ModeSignals` additive 확장 후속.
- **관측 = 구조적 로그**(전이마다 `app.log.warn`). 이벤트 스트림 미도입(소비자 없는 orphan 회피·로그가 M8 비-무음 충족).
- **신규 flag** `MANAGER_DEGRADED_MODE`(기본 false). off→ModeController 미생성·회귀 0.

## 아키텍처 (FSM)

```
신호(provider open·budget daily trip) → desiredMode (SAFE>DEGRADED>NORMAL)
악화(desired 심각도 > current): 즉시 desired로 점프 (장애는 빠르게 반영)
호전(desired < current): 히스테리시스 — stabilityWindow 경과 후 1단계씩 (SAFE→DEGRADED→NORMAL), 플래핑 방지(§1)
동급: 무변
전이 시 → app.log.warn(구조적·from/to/reason·M8 비-무음) · getMode() 갱신
```

## 각 단위 계약

### 순수 FSM 코어 (`xzawedShared/src/resilience/operational-mode.ts`)
- `OperationalMode = 'NORMAL' | 'DEGRADED' | 'SAFE'`
- `ModeSignals`(additive optional): `{ providerCircuitOpen?: boolean; budgetDailyTripped?: boolean }` (후속 신호 필드 추가 여지)
- `desiredMode(s: ModeSignals): OperationalMode` (순수): `budgetDailyTripped → SAFE`, else `providerCircuitOpen → DEGRADED`, else `NORMAL`.
- `nextMode(input): ModeTransitionResult` (순수·1-tick):
  - 입력 `{ current: OperationalMode; desired: OperationalMode; now: number; recoveryEligibleAt: number | null; stabilityWindowMs: number }`
  - 결과 `{ mode: OperationalMode; changed: boolean; recoveryEligibleAt: number | null; reason: string }`
  - **악화**(severity[desired] > severity[current]): `mode=desired`(점프)·`changed=true`·`recoveryEligibleAt=null`.
  - **동급**: `mode=current`·`changed=false`·`recoveryEligibleAt=null`.
  - **호전**(desired < current): `recoveryEligibleAt===null`이면 타이머 시작(`recoveryEligibleAt=now+window`)·머무름(changed=false). `now>=recoveryEligibleAt`이면 1단계 하향(`stepDown`)·더 내려갈 단계 남으면 타이머 재시작 else null·changed=true. 미경과면 유지(changed=false·타이머 보존).
  - `severity={NORMAL:0,DEGRADED:1,SAFE:2}`·`stepDown(SAFE)=DEGRADED`·`stepDown(DEGRADED|NORMAL)=NORMAL`.
- 배럴 export(`src/index.ts`)에 추가.

### `BudgetCircuitBreaker.dailyTripped()` (`xzawedShared/src/budget/budget-circuit.ts`·additive)
- `dailyTripped(): boolean` — `rolloverIfNeeded()` 후 `this.daySpend >= this.dailyUsd`. snapshot이 cap 미노출이라 SAFE 신호 조회용 신규 메서드(관측 전용·기존 동작 무변경).

### `ModeController` (`xzawedManager/packages/server/src/streams/mode-controller.ts`·`IntervalSweeper` 상속)
- `ModeControllerDeps`: `{ signals: () => ModeSignals; stabilityWindowMs: number; onTransition?: (from: OperationalMode, to: OperationalMode, reason: string) => void; now?: () => number }`
- 내부 상태: `mode: OperationalMode = 'NORMAL'`·`recoveryEligibleAt: number | null = null`.
- `tick(now)`: `desiredMode(deps.signals())` → `nextMode(...)` → `recoveryEligibleAt` 갱신 → `changed`면 `from=mode; mode=result.mode; onTransition?.(from, mode, reason)`. never-throw(`IntervalSweeper`가 onError 흡수·signals throw도 가드).
- `getMode(): OperationalMode` 노출(후속 enforcement/UI 소비용·슬라이스1은 호출자 없음).

### 배선 (`server.ts`·`config.ts`)
- `config.ts`: `MANAGER_DEGRADED_MODE`(flag)·`MANAGER_MODE_SWEEP_MS`(`z.coerce.number().int().positive().default(5000)`)·`MANAGER_MODE_STABILITY_WINDOW_MS`(default 60000).
- `server.ts`: `MANAGER_DEGRADED_MODE`이면 `ModeController` 생성:
  - `signals = () => ({ providerCircuitOpen: providerCircuit?.breaker.snapshot().state === 'open', budgetDailyTripped: budget?.breaker.dailyTripped() ?? false })`(러너·G1과 동일 breaker 인스턴스)
  - `onTransition = (from, to, reason) => app.log.warn(...)`(M8 비-무음)
  - `sweepMs = MANAGER_MODE_SWEEP_MS`·`stabilityWindowMs = MANAGER_MODE_STABILITY_WINDOW_MS`
  - `.start()` 가동·`closeAll`에서 `.stop()`. off면 미생성(회귀 0).
  - 오진 경고: `MANAGER_DEGRADED_MODE`인데 budget·provider 서킷 둘 다 미구성이면(신호원 0) warn.

## flag · 전제

- **`MANAGER_DEGRADED_MODE`**(기본 false): on이면 ModeController 가동(모드 추적·로그). 실효성엔 budget(`MANAGER_BUDGET_*`) 또는 provider(`MANAGER_PROVIDER_CIRCUIT`) 서킷 중 하나 이상(신호원). off→미생성·회귀 0.
- **migration 0·이벤트 스트림 0**(로그만). 신규 env 2(sweep·window).

## 검증 (TDD)

- **`desiredMode`(순수·unit)**: 무신호→NORMAL·providerOpen→DEGRADED·budgetDailyTripped→SAFE·둘 다→SAFE(최심).
- **`nextMode`(순수·unit)**: NORMAL→SAFE 악화 즉시 점프(recoveryEligibleAt null)·SAFE→NORMAL desired 호전 시 윈도 전 유지(타이머 set)·윈도 경과 시 SAFE→DEGRADED 1단계(타이머 재시작)·다음 tick DEGRADED→NORMAL(타이머 null)·동급 무변·악화가 복귀 타이머 리셋.
- **`dailyTripped()`(unit)**: cap 미만 false·이상 true·일 롤오버 시 리셋.
- **`ModeController`(unit·mock signals·주입 now)**: 신호 변화→tick→onTransition 호출(from/to)·미변화→미호출·signals throw→never-throw·getMode 반영·히스테리시스(연속 tick).
- **배선(unit)**: `MANAGER_DEGRADED_MODE` on→ModeController 생성·off→미생성(회귀 0).
- **회귀**: 전체 Manager 스위트 그린(flag off 바이트 동일).

## 수용 기준

1. `MANAGER_DEGRADED_MODE` off → ModeController 미생성·동작 바이트 동일(회귀 0).
2. on + provider 서킷 open → 다음 tick에 NORMAL→DEGRADED 전이·구조적 warn 로그(M8).
3. on + budget daily trip → SAFE 전이(악화 즉시).
4. 신호 해소 → stabilityWindow 경과 후에만 1단계씩 상향 복귀(즉시 복귀 금지·플래핑 방지).
5. enforcement 0: getMode()는 노출만, 디스패치/게이트 동작 불변.
6. ModeController never-throw(signals·onTransition 실패가 폴러를 죽이지 않음).

## 비범위 (후속 — 명시)

- **P5-3b enforcement**: SAFE→신규 디스패치 보류(handleDispatch 모드 체크)·DEGRADED→HIGH-risk 사인오프(N2)·SAFE→재개 사인오프.
- **추가 신호원**: 브로커 저하·Supervisor 하트비트 상실·이벤트스토어 쓰기실패·보안사고·지연 급증.
- **모드 이벤트 스트림·UI surface**(현재 로그만).
- **P5-4 saga 보상**·**P5-5 canary/롤백**.
- per-workflow budget trip을 DEGRADED 신호로(현재 daily만 SAFE).
- **stuck-DEGRADED 한계**(적대 리뷰 발견·비차단): provider 서킷이 open된 뒤 호출이 없으면(idle) `before()` probe가 안 일어나 `snapshot().state`가 open에 고착 → ModeController가 DEGRADED를 무한 보고할 수 있다. observe-only라 게이팅 영향 0·**fail-safe 방향**(실제보다 과대 강등 보고)이라 비차단. enforcement(P5-3b) 도입 시 idle-probe 또는 모드 TTL로 처리 권장. (즉시 tick 부재 — 첫 전이가 최대 sweepMs 지연 — 도 P5-3b에서 함께 고려.)
