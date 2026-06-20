# B1 결정 EXPIRED sweep 설계 (decision expiry)

> 상태: 설계 승인(브레인스토밍 2026-06-21). 다음: 구현 계획(writing-plans).

## 목표

사람 판단이 필요한 `DecisionRequest`(defect_brief·degraded_release)가 응답 없이 **PENDING에 영구 정체**하는 것을 막는다. 생성 시 `expiresAt`(TTL)을 부여하고, 주기적 sweep이 만료된 PENDING을 `EXPIRED`로 전이하며 `decision.expired` 에스컬레이션 이벤트를 발행한다(senario M8 — EXPIRED는 자동 통과가 아니라 비-무음 신호).

## 배경: 절반만 구현된 생명주기

- `DecisionRepo.createRequest`는 이미 `expiresAt`을 입력 받아 `decision_requests.expires_at`(TIMESTAMPTZ)에 영속한다 — **그러나 `buildDefectBrief`/`buildSignoffBrief` 어느 쪽도 값을 설정하지 않아 항상 null**.
- `DecisionRepo.expireRequest(requestId)`는 존재한다(PENDING→EXPIRED·`FOR UPDATE` 가드·`decision.expired`를 manager_events+manager_outbox 단일 tx 발행·M8 문서화) — **그러나 호출하는 주체가 없다**.
- **만료된 PENDING을 찾는 읽기 메서드·sweep 타이머·`(status, expires_at)` 인덱스가 없다.**
- 결과: 결정 생명주기의 `EXPIRED` 경로가 도달 불가(반쪽). B1이 이 셋을 채워 닫는다.

## 안전·범위 모델

- **B1 범위 = ① expiresAt 생성 시 부여 ② 만료 sweep → expireRequest 호출(이벤트 발행)**. `decision.expired` **소비자(재에스컬레이션·알림)는 B1 범위 밖**(후속). 이벤트 발행 자체가 M8 비-무음 바: manager_events 영속(감사) + 스트림 게시(자동 통과 아님).
- **이후 생성분만** expiresAt 설정. 레거시 PENDING 행은 expires_at=null → sweep의 `expires_at IS NOT NULL` 술어로 자동 제외(소급 만료 없음).
- **fail-safe**: sweep은 절대 throw 안 함(항목별 try/catch). expireRequest의 PENDING-only 가드가 경합(동시 결정 제출)에서 이중 전이를 차단.

## 컴포넌트 (전부 additive·flag 뒤·회귀 0)

### 1. 생성 시 `expiresAt` 부여 (`streams/decision-brief.ts`·`streams/signoff-brief.ts`)

- **`DecisionRequestInput` 확장**(decision-brief.ts): `expiresAt?: string | null` 필드 추가(`DecisionBriefStore.createRequest` 입력이 이미 `createRequest` 시그니처와 호환).
- **순수 빌더는 시계 무관 유지**: `buildDefectBrief`/`buildSignoffBrief`는 `expiresAt`을 설정하지 않는다(결정론·requestId 정체성 불변 N4 — expiresAt은 식별자 아님).
- **공유 순수 헬퍼** `expiresAtFrom(now: number, ttlMs: number | undefined): string | undefined`(decision-brief.ts·export): `ttlMs`가 양수면 `new Date(now + ttlMs).toISOString()`, 아니면 `undefined`. signoff-brief가 import(CPD 0).
- **핸들러가 병합**: `makeEscalationBrief(store, opts?)`·`makeSignoffBrief(store, graphStore?, opts?)`에 `opts?: { now?: () => number; ttlMs?: number }` 추가. 핸들러가 `const expiresAt = expiresAtFrom((opts?.now ?? Date.now)(), opts?.ttlMs)` 계산 후 `store.createRequest({ ...buildX(info), ...(expiresAt && { expiresAt }) })`. `ttlMs` 미주입(flag off)이면 `expiresAt` 부재 → **현재 동작과 동일(회귀 0)**.

### 2. `DecisionRepo.expiredPendingRequests(now, limit)` (읽기 신규)

```ts
expiredPendingRequests(now: number, limit: number): Promise<string[]>   // requestId[] 반환(sweep은 id만 필요)
```

SQL — `now`는 ms epoch이므로 `to_timestamp($1 / 1000.0)`로 변환:

```sql
SELECT request_id
FROM decision_requests
WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at < to_timestamp($1 / 1000.0)
ORDER BY expires_at ASC
LIMIT $2
```

- `expires_at IS NOT NULL`로 레거시 행 자동 제외.
- `ORDER BY expires_at ASC`로 가장 오래 만료된 것부터·`LIMIT`으로 배치 상한(폭주 방어).
- 반환은 `request_id` 문자열 배열(sweep이 `expireRequest(id)` 호출에만 사용).
- **strictly-before(`<`)**: `expires_at == now`인 행은 다음 주기(≤sweepMs)로 밀림(72h TTL 대비 수초 지연 무시 가능). 비교는 **모두 UTC** — `expires_at`(TIMESTAMPTZ) ↔ `to_timestamp(epoch/1000)`는 서버 TZ 무관, `new Date().toISOString()`도 항상 `Z`. **`decision_requests.expires_at`은 TIMESTAMPTZ**(wp_leases.expires_at의 BIGINT와 다름 — `to_timestamp` 변환이 그래서 필수).

### 3. `DecisionSweeper` + `handleDecisionSweep` (`streams/decision-sweeper.ts` 신규·`LeaseSweeper` 미러)

**순수 오케스트레이션** `handleDecisionSweep(now, deps)`:
```ts
// named interface — DecisionRepo가 구조적으로 만족(SupervisorDeps.decisionStore 인터섹션에 포함, §5)
interface DecisionSweepStore {
  expiredPendingRequests(now: number, limit: number): Promise<string[]>
  expireRequest(id: string): Promise<{ eventId: string } | null>
}
interface DecisionSweepDeps {
  store: DecisionSweepStore
  batchLimit?: number   // 기본 100
}
async function handleDecisionSweep(now: number, deps: DecisionSweepDeps): Promise<{ expired: number; skipped: number }>
```
- `expiredPendingRequests(now, batchLimit)` → 항목별 `try { const r = await expireRequest(id); r ? expired++ : skipped++ } catch { skipped++ }`(never-throw·PENDING-only 가드가 null로 skip 처리).

**타이머** `DecisionSweeper`(LeaseSweeper 구조 미러):
```ts
class DecisionSweeper {
  constructor(deps: DecisionSweepDeps, sweepMs = 60_000, now: () => number = () => Date.now())
  start(): void   // setInterval → void pollOnce(); 이미 시작됐으면 무시
  stop(): void    // clearInterval
  // pollOnce: 재진입 가드(sweeping)·handleDecisionSweep·catch 경고 never-throw·finally 리셋
}
```

### 4. migration 016 — sweep 인덱스 (`016_decision_requests_sweep.sql`)

```sql
CREATE INDEX IF NOT EXISTS idx_decision_requests_sweep ON decision_requests (status, expires_at);
```
(`008_wp_leases.sql`의 `idx_wp_leases_sweep (status, expires_at)` 미러. rerun-safe IF NOT EXISTS.)

### 5. 배선 (`config.ts`·`supervisor.ts`·`server.ts`)

`config.ts`:
```ts
MANAGER_DECISION_EXPIRY: z.string().optional().transform((v) => v === 'true'),          // 기본 false
MANAGER_DECISION_TTL_HOURS: z.coerce.number().int().positive().default(72),             // 결정 TTL
MANAGER_DECISION_SWEEP_MS: z.coerce.number().int().positive().default(60_000),          // sweep 주기
```

`supervisor.ts`:
- `SupervisorConfig`에 `decisionExpiry?: boolean`·`decisionSweepMs?: number`·`decisionTtlMs?: number`(**ms 단위** — server가 시간→ms 변환 후 주입) 추가.
- **`SupervisorDeps.decisionStore` 인터섹션 타입에 `expiredPendingRequests(now: number, limit: number): Promise<string[]>` 추가**(현재 `DecisionBriefStore & { getRequest; recordSignOff }` — 미추가 시 `new DecisionSweeper({ store: deps.decisionStore })`가 **TS strict 컴파일 에러**). DecisionRepo가 그 메서드를 구현하면 구조적으로 충족(`DecisionSweepStore`도 만족).
- `SupervisorComponents`에 `decisionSweeper?: SweeperLike` 추가(LeaseSweeper와 동일 `SweeperLike` 타입·supervisor.ts에 기정의 재사용).
- `createSupervisor`: `config.decisionExpiry && deps.decisionStore`(**double-guard**)면 `new DecisionSweeper({ store: deps.decisionStore }, config.decisionSweepMs)` 구성. **TTL 스레딩**: `decisionExpiry`면 `makeEscalationBrief(briefStore, { ttlMs: config.decisionTtlMs })`·`makeSignoffBrief(deps.decisionStore, deps.repo, { ttlMs: config.decisionTtlMs })`로 ttlMs 주입(off면 미주입 → expiresAt 부재).
- `Supervisor.start()`/`stop()`이 `decisionSweeper?.start()`/`stop()` 호출.

`server.ts`:
- `config.MANAGER_DECISION_EXPIRY`·`MANAGER_DECISION_SWEEP_MS`(ms·무변환)·**`MANAGER_DECISION_TTL_HOURS * 3_600_000`(시간→ms 변환·`decisionTtlMs`로 주입)**을 `createSupervisor`에 전달. ⚠️ TTL은 시간→ms 변환, SWEEP_MS는 이미 ms(무변환) — 혼동 시 72배 오계산.
- **`decisionStore` 생성 조건을 `pool && (MANAGER_DECISION_BRIEF || MANAGER_DECISION_ROUTING || MANAGER_DECISION_EXPIRY)`로 확장**(EXPIRY-only 토글 시에도 sweep용 `DecisionRepo` 생성 — 현재 `BRIEF||ROUTING`만이라 EXPIRY-only면 store 부재로 Sweeper 미구성).
- **OutboxRelay 기동 조건에 `MANAGER_DECISION_EXPIRY` 추가**(`decision.expired` 아웃박스→Redis 발행 필수 — 없으면 published_at=NULL 잔류·**M8 비-무음 위반**).
- 전제 경고 2종(`app.log.warn`): ①`MANAGER_DECISION_EXPIRY`인데 pool 부재(`decisionStore` 미생성). ②`MANAGER_DECISION_EXPIRY`+pool인데 `TASK_MANAGER_ENABLED` off — **DecisionSweeper는 `createSupervisor`(=`shouldWireSupervisor(TASK_MANAGER_ENABLED, pool)`) 안에서만 구성**되므로 Supervisor 미배선 시 sweep·expiresAt 주입 모두 비활성(무음 no-op 방지).
- **전제: `TASK_MANAGER_ENABLED`+`DATABASE_URL`**(`MANAGER_DECISION_BRIEF`/`ROUTING`과 동일 — sweep/expiresAt 주입이 Supervisor 배선에 의존).

## 결정 (승인됨)

- **TTL 기본 72시간**(`MANAGER_DECISION_TTL_HOURS` env 조정). 단일 TTL — 타입별(defect_brief vs degraded_release) 차등은 후속.
- **별도 flag `MANAGER_DECISION_EXPIRY`**(기본 false·가역) — `BRIEF`/`ROUTING`과 독립 토글. off면 expiresAt 미설정 + sweep 미배선 = 현재 동작.
- **sweep 주기 60초**(`MANAGER_DECISION_SWEEP_MS`) — 만료는 시간 단위라 분 단위 sweep으로 충분.

## 불변식

- **회귀 0**: `MANAGER_DECISION_EXPIRY` off → 핸들러에 ttlMs 미주입(expiresAt 부재)·DecisionSweeper 미구성 → 결정 생성·생명주기 바이트 동일.
- **never-throw**: `DecisionSweeper.pollOnce`·`handleDecisionSweep` 항목별 try/catch — 한 만료 실패가 다른 항목·타이머를 막지 않음(LeaseSweeper 패턴).
- **M8 비-무음**: 만료는 `expireRequest`로 `decision.expired`를 영속+발행(자동 통과 금지). PENDING-only 가드로 이미 RESOLVED/SUPERSEDED된 것은 전이 안 함.
- **N4 식별자 안정**: `expiresAt`은 requestId에 포함 안 됨(빌더 순수·결정론 유지).
- **레거시 안전**: `expires_at IS NOT NULL`로 소급 만료 0(이전 PENDING은 skip).

## 알려진 한계 (후속)

1. **`decision.expired` 소비자 없음**: B1은 발행까지(M8 바). 재에스컬레이션(예: 상위 권한 라우팅)·UI 알림·자동 fallback은 후속.
2. **단일 TTL**: 타입·심각도별 차등 TTL은 후속.
3. **갱신/연장 없음**: 사람이 보는 중 TTL 연장(touch)은 후속. 만료 후 재요청은 새 requestId(다음 attempt/version).
4. **at-least-once sweep**: 동일 만료 행을 두 sweep이 잡아도 `expireRequest` PENDING-only 가드 + ON CONFLICT(멱등)로 이중 발행 차단.

## 테스트 전략

1. **`expiresAtFrom` 순수 단위**: ttlMs 양수 → now+ttl ISO·undefined/0/음수 → undefined.
2. **`makeEscalationBrief`/`makeSignoffBrief` 단위**(mock store): ttlMs 주입 시 createRequest 입력에 expiresAt 존재·**미주입 시 키 부재**(`...(expiresAt && {expiresAt})` 스프레드 — `exactOptionalPropertyTypes` 하 `expiresAt:undefined`가 아닌 키 생략 확인·회귀 0).
3. **`handleDecisionSweep` 순수 단위**(stub store): expiredPendingRequests가 [id1,id2] → expireRequest 2회·expired=2·expireRequest null(비-PENDING)→skipped·throw→skipped(never-throw).
4. **`DecisionSweeper` 단위**: start→타이머 등록·재진입 가드(sweeping 중 재호출 noop)·stop→clearInterval·pollOnce throw 삼킴.
5. **`expiredPendingRequests` DB 통합**(skip-if-no-DB·prefix `wf-dx-`): PENDING+과거 expires_at(now-1s) 시드→반환·**경계**(expires_at=now+1s 미래→제외)·expires_at NULL(레거시)→제외·非PENDING(RESOLVED)→제외·LIMIT 준수.
6. **end-to-end DB 통합**: createRequest(expiresAt 과거)→`expiredPendingRequests`→`expireRequest`→status=EXPIRED·`decision.expired` manager_events 1건.

## 전역 제약 (Global Constraints)

- TypeScript 5 strict. pnpm 전용. 모든 변경 **additive**(기존 시그니처·동작 보존).
- migration 016 추가(인덱스만·additive·rerun-safe). migration 다음=017.
- 새 flag `MANAGER_DECISION_EXPIRY`(기본 false). off면 회귀 0.
- `DecisionSweeper`·`handleDecisionSweep`는 **절대 throw 안 함**(LeaseSweeper 패턴).
- 순수 빌더(`buildDefectBrief`/`buildSignoffBrief`)는 시계 무관 유지(expiresAt은 핸들러가 주입).
- 커밋 메시지 한국어·말미 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Orchestrator 변경 0. `decision.expired` 소비자는 범위 밖.
- jscpd 0 clones·SonarCloud QG(신규 커버 80%·D-Reliability 함정·인지복잡도 S3776≤15).
