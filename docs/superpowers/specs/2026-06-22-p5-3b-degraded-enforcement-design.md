# P5-3b — 강등 모드 enforcement: SAFE 디스패치 보류 + 복구 재개

**날짜**: 2026-06-22
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/senario/OPERATIONS_DECISIONS.md` §1(강등 모드 NORMAL/DEGRADED/SAFE) · senario §13/§17
**선행 슬라이스**: P5-3a 강등 모드 FSM 추적(observe-only·#327) · §13 budget 서킷(#283) · P1d-4 dispatch(handleDispatch) · P1d-7 Supervisor 런타임 배선

## 배경

P5-3a(#327)는 운영 강등 모드(NORMAL/DEGRADED/SAFE)를 신호 구동 FSM으로 **추적·관측**하고 `getMode()`로 노출하되 **enforcement는 하지 않았다**(observe-only). 모드가 SAFE여도 디스패치/게이트 동작은 전혀 영향받지 않았다.

P5-3b는 P5-3a가 노출한 `getMode()`를 **처음으로 실제 게이팅에 연결**한다. P5-3(로드맵)의 enforcement는 세 동작(SAFE→신규 디스패치 보류·DEGRADED→HIGH-risk 사인오프 N2·SAFE→재개)을 묶으나, 본 슬라이스는 가장 근본적이고 blast radius가 작은 **SAFE 디스패치 보류 + 복구 재개**만 다룬다. DEGRADED HIGH-risk 사인오프(N2)는 별도 슬라이스(DecisionRepo·C1 결합).

## 범위 결정 (브레인스토밍 확정)

- **SAFE 디스패치 보류만**: 모드가 SAFE면 `handleDispatch`가 신규 디스패치를 보류(held)한다. **DEGRADED는 디스패치 무영향**(DEGRADED enforcement=HIGH-risk 사인오프 N2는 별도 슬라이스). SAFE는 budget 일 상한 트립이 유일 신호원이라, budget 서킷이 이미 LLM 호출을 fail-closed하는 상태에서 디스패치까지 보류해 WP가 DISPATCHED로 진입·검증 실패·lease 소비하는 낭비를 막는다.
- **복구 재개 = in-memory held-set**: SAFE에 보류된 워크플로만 held-set(`Set<string>`)에 기록하고, SAFE 이탈 전이 시 드레인해 재디스패치한다. 정확·바운드(보류된 것만)·신규 repo 메서드 불필요. ⚠️ 재시작 시 held-set 소실(기존 "startup 재디스패치 없음" 한계와 동일·문서화).
- **신규 flag** `MANAGER_DEGRADED_ENFORCE`(기본 false). observe-only(`MANAGER_DEGRADED_MODE`)와 분리 — 운영자가 모드 추적만 먼저 켜고 관찰 후 enforcement를 켤 수 있다. off→getMode 미주입·resume 미배선→P5-3a와 바이트 동일(회귀 0).
- **shared 변경 0**: 전부 manager-side(dispatch.ts·mode-controller.ts·supervisor.ts·config.ts·server.ts). `OperationalMode` 타입은 이미 `@xzawed/agent-streams` export — 신규 export 0·cross-package 재전파 불필요.

## 아키텍처

```
SAFE 모드(budgetDailyTripped) → handleDispatch(getGraph 후) getMode()==='SAFE' 체크
                                  → onHeld(wf)로 held-set 기록 + status:'held' 반환(recordDispatch·publish 미실행)
                                  → held WP는 DRAFTED 유지(전이 0)
                                  (DEGRADED·NORMAL은 디스패치 정상 진행)

ModeController tick: 전이 시 from==='SAFE'(SAFE→DEGRADED 또는 SAFE→NORMAL)
                                  → onTransition(로그) 후 onRecover() 호출
                                  → server.ts: supervisor.resumeDispatch()
                                  → drainHeld(held-set) → 각 wf handleDispatch 재호출
                                    (이미 모드≠SAFE → 정상 디스패치·publishDispatchSignal·워커 트리거)
```

- **단일 chokepoint**: `handleDispatch(wf, dispatch)`는 decomposition afterPersisted·completion 재디스패치·oracle.approved 재디스패치 **세 경로가 공유하는 단일 dispatch 객체**를 받는다. `getMode` 한 곳 주입으로 전 디스패치 경로 커버.
- **재개 시 모드 정상**: SAFE 이탈 후 resume이 돌므로 `getMode()`는 비-SAFE 반환 → handleDispatch가 정상 디스패치. 모드가 다시 SAFE로 플랩되면(히스테리시스로 드묾) 재보류(self-healing).

## 각 단위 계약

### 1. `dispatch.ts` — SAFE 게이트
- `DispatchDeps`에 additive optional 2개:
  - `getMode?: () => OperationalMode` (`@xzawed/agent-streams` 타입).
  - `onHeld?: (workflowId: string) => void` (보류 시 콜백 — held-set 적재용·`publish`/`now`와 동형 optional seam).
- `handleDispatch`: `getGraph` 후 `if (!stored) return noop` 다음에 **`if (deps.getMode?.() === 'SAFE') { deps.onHeld?.(workflowId); return { status: 'held', dispatched: [], skipped: 0 } }`**. recordDispatch·publishDispatchSignal 미실행. held WP는 상태 전이 없음(DRAFTED 유지).
- `DispatchOutcome.status` union에 `'held'` 추가(additive). 미주입(getMode undefined)→기존 분기 바이트 동일(회귀 0).
- **게이트 위치**: getGraph **후**(held는 "그래프가 있는데 SAFE로 보류"를 의미·missing-graph는 기존대로 noop 유지). SAFE는 드물어 추가 getGraph 1회 비용 무시 가능.

### 2. `mode-controller.ts` — SAFE 이탈 감지
- `ModeControllerDeps`에 `onRecover?: () => void` additive.
- `tick`: `r.changed`면 `from=this.mode; this.mode=r.mode; onTransition?.(from, r.mode, reason)` 후 **`if (from === 'SAFE') deps.onRecover?.()`**. SAFE→DEGRADED·SAFE→NORMAL만 발화(다른 전이 미발화). never-throw(IntervalSweeper.pollOnce가 흡수). 모드 상태 갱신은 콜백 호출 **전**(throw해도 상태 일관).

### 3. `supervisor.ts` — 재개 오케스트레이션
- `SupervisorDeps`에 `getMode?: () => OperationalMode` additive.
- `createSupervisor`: `getMode` 주입 시 dispatch deps에 `getMode`+`onHeld: (wf) => held.add(wf)` 합류(`const held = new Set<string>()`). 미주입(enforce off)이면 둘 다 생략 → 회귀 0.
- `resumeDispatch` 클로저 = `drainHeld(held, (wf) => handleDispatch(wf, dispatch))`. `Supervisor.resumeDispatch(): Promise<void>` 메서드로 노출(`SupervisorComponents.resumeDispatch?: () => Promise<void>` 주입·미주입이면 no-op).
- **`drainHeld(held, dispatchOne)` 순수 헬퍼 추출**(테스트 가능): `const ids = [...held]; held.clear();` 후 각 id를 `dispatchOne`으로 **per-item never-throw**(한 워크플로 실패가 나머지 비차단). 드레인-후-처리라 처리 중 추가된 held는 다음 resume 대상(over-approximation 안전).

### 4. `config.ts` — `MANAGER_DEGRADED_ENFORCE`
- `z.coerce.boolean().default(false)` (기존 boolean flag 패턴). 
- 전제(실효성): `MANAGER_DEGRADED_MODE`(ModeController·getMode 원천) + `TASK_MANAGER_ENABLED`+`DATABASE_URL`(Supervisor·dispatch). off→enforcement 미배선.

### 5. `server.ts` — 배선
- `let supervisor: Supervisor | undefined` forward 선언(onRecover 클로저가 캡처).
- `const enforceDegraded = config.MANAGER_DEGRADED_ENFORCE && config.MANAGER_DEGRADED_MODE`.
- ModeController 생성 시 `...(enforceDegraded && { onRecover: () => { void supervisor?.resumeDispatch().catch((err) => app.log.error({ err }, '[degraded] resume 디스패치 실패')) } })` 조건부 주입.
- **`modeController?.start()`를 supervisor 생성 이후로 이동**(첫 tick(≥sweepMs) 전 supervisor 할당 보장).
- SupervisorDeps 조립 시 `...(enforceDegraded && modeController && { getMode: () => modeController.getMode() })`.
- 오진 경고 2종: `MANAGER_DEGRADED_ENFORCE`인데 ①`MANAGER_DEGRADED_MODE` off(모드 추적 없음→enforcement 무력) ②`TASK_MANAGER_ENABLED` off(Supervisor 없음→getMode/resume 무력).

## flag · 전제

- **`MANAGER_DEGRADED_ENFORCE`**(기본 false): on(+`MANAGER_DEGRADED_MODE`+`TASK_MANAGER_ENABLED`+pool)이면 SAFE 디스패치 보류·복구 재개 enforcement. off→P5-3a observe-only와 바이트 동일(회귀 0).
- **migration 0·이벤트 스트림 0·shared 변경 0**. 신규 env 1(`MANAGER_DEGRADED_ENFORCE`).

## 검증 (TDD)

- **`dispatch.ts`(unit)**: getMode→SAFE면 held 반환·recordDispatch 미호출·onHeld(wf) 호출·held WP 전이 0; getMode→NORMAL/DEGRADED면 정상 디스패치; getMode 미주입이면 기존 동작 바이트 동일(회귀 0); SAFE held는 missing-graph보다 우선순위 아래(getGraph 없으면 noop 유지).
- **`mode-controller.ts`(unit·mock)**: SAFE→DEGRADED·SAFE→NORMAL 전이 시 onRecover 호출(1회); NORMAL→DEGRADED·DEGRADED→SAFE·동급 미호출; onRecover throw→never-throw(onError 흡수)·getMode 일관; onRecover 미주입이면 무호출(P5-3a 회귀 0).
- **`drainHeld`(unit·순수)**: 드레인 후 held 비움·각 id dispatchOne 호출·per-item throw가 나머지 비차단(never-throw)·빈 set no-op.
- **`supervisor.ts`(unit)**: getMode 주입→dispatch deps에 getMode+onHeld 존재·held add 동작; 미주입→둘 다 부재(회귀 0); `Supervisor.resumeDispatch()` 위임(미주입 컴포넌트 no-op).
- **배선(unit)**: `MANAGER_DEGRADED_ENFORCE` on+MODE on→getMode 주입·onRecover 배선; ENFORCE off→미배선(회귀 0); ENFORCE on+MODE off→경고.
- **DB 통합(`test/degraded-enforce.integration.test.ts`, skip-if-no-DB·`wf-de-` prefix)**: SAFE getMode→handleDispatch held(디스패치 0·DRAFTED 유지)→getMode NORMAL 복귀+resumeDispatch→해당 WP DISPATCHED 전이(보류→재개 루프 실증).
- **회귀**: 전체 Manager 스위트 그린(flag off 바이트 동일).

## 수용 기준

1. `MANAGER_DEGRADED_ENFORCE` off → getMode 미주입·resume 미배선·동작 바이트 동일(회귀 0).
2. on + 모드 SAFE → handleDispatch가 held 반환(신규 디스패치 0·held WP DRAFTED 유지·onHeld 적재).
3. on + 모드 DEGRADED/NORMAL → 디스패치 정상 진행(SAFE만 보류).
4. 모드 SAFE 이탈(→DEGRADED 또는 NORMAL) → onRecover→resumeDispatch가 held 워크플로 재디스패치.
5. `drainHeld`/`resumeDispatch` never-throw(한 워크플로 실패가 나머지·폴러 비차단).
6. enforce 배선은 `MANAGER_DEGRADED_MODE`+`TASK_MANAGER_ENABLED` 전제 — 미충족 시 경고(무음 무력화 금지).

## 비범위 (후속 — 명시)

- **DEGRADED HIGH-risk 사인오프(N2)**: DEGRADED 모드에서 HIGH-risk WP 디스패치 전 사람 사인오프 DecisionRequest 요구(DecisionRepo·C1 결합). 별도 슬라이스.
- **reclaim·fix_reverify 경로 게이팅**: lease sweep reclaim(`lease.ts` publishDispatchSignal)·사람 fix_reverify(`decision-consumer.ts`)는 "신규 디스패치"가 아닌 "in-flight 회복·사람 재진입"이라 이 슬라이스에서 미게이팅(후속). SAFE 중에도 reclaim 재실행은 budget 서킷이 fail-closed로 백스톱.
- **재시작 시 held 복원·startup 재디스패치 sweep**: held-set은 in-memory(재시작 소실). 재시작 중 보류된 WP는 기존 이벤트 구동 디스패치(decompose/completion/oracle)에 의존(현 시스템의 startup 재디스패치 부재와 동일 한계). durable held 추적·startup 재디스패치는 후속.
- **즉시 tick(게이트 지연 최대 sweepMs)**: 모드가 SAFE로 전이하기까지 최대 `MANAGER_MODE_SWEEP_MS`(5s) 지연 — 그 사이 디스패치 가능. budget 서킷이 LLM을 즉시 fail-closed하므로 안전-비차단. 즉시 tick·모드 TTL은 후속.
- **추가 신호원**(브로커·Supervisor 하트비트·이벤트스토어 쓰기실패·보안사고·지연)·**모드 UI surface**·**P5-4 saga**·**P5-5 canary/롤백**.
