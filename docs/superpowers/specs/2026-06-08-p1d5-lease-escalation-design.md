# P1d-5 lease/escalation (가시성 타임아웃 lease · reclaim · escalate) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 다섯 번째 슬라이스(5/7). P1d-4 디스패치(#258) 다음.
- **PR 분할**: 리뷰성을 위해 **5a**(lease 획득 on dispatch + §8 하드닝) / **5b**(reclaim·escalate sweep) 두 PR로 구현. 설계 스펙은 본 문서 1개를 공유.

## 1. 목표 & 비범위

디스패치된 WP에 **가시성 타임아웃(visibility timeout) lease**를 부여하고, 만료(워커 死/stuck) 시 **reclaim(재할당 attempt++)→상한 초과 시 escalate(사람)**한다. 동시에 P1d-4 적대적 리뷰 §8 한계(멱등키 위치 의존성·DB 레벨 dedup 부재)를 해소한다. Task Manager는 **결정론 유지**(reclaim/escalate 판정은 순수 코드, LLM 0).

**범위(5a)**: migration 008 `wp_leases` + `recordDispatch` lease 획득·§8 멱등키 WP 고정·DB dedup + `handleDispatch` visibilityMs.
**범위(5b)**: `LeaseStore`(만료 조회 + 원자 reclaim/escalate) + `planReclaim`(순수) + `handleLeaseSweep`(오케스트레이션).

**비범위(후속, 엄격 제외)**: **실제 sweep 타이머·Supervisor 배선**(setInterval LeaseSweeper·server.ts — P1d-6/배선)·**wp.completed 흐름**(완료 시 lease release·후행 unblock 재평가)·**실제 워커/owner 배정**(owner는 nullable seam)·**escalate 후 사람 재개입 UI**·**WORKFLOW §B 잔여 상태머신 전체**·**wp_state_log/wp_leases CHECK 제약**(상태 미확정·TEXT 전방호환). 미배선(트리거 없음).

## 2. 설계 결정 (PO 승인)

1. **슬라이스 = 미배선 코어 + 테스트** [PO]. lease 만료 판정·reclaim/escalate 원자 적재 + 테스트만. 실제 sweep 타이머·wp.completed 흐름은 후속.
2. **lease 저장 = 전용 `wp_leases` 표(migration 008)** [PO]. `(workflow_id, wp_id)` PK = 가변 프로젝션(1행/WP). 명시적 `owner`·`attempt`·`expires_at`·`status`로 만료 조회·재할당이 단순. **PK가 §8 #2 dedup 게이트**(동시 dispatch → ON CONFLICT). wp_state_log는 감사 전이 로그 유지.
3. **만료 정책 = 재할당(attempt++) → 상한 초과 시 escalate** [PO]. 만료 lease를 reclaim해 attempt+1로 재디스패치(봉투 attemptId++). `maxAttempts`(기본 3) 초과 시 `wp.escalated`(사람). 일반 visibility-timeout 패턴.
4. **§8 멱등키 후속 포함** [PO]. ① **멱등키 WP 고정**: `stepId='wp-${wpId}'` → 키 `{wf}:wp-${wpId}:${attempt}`(재분해 무관·attempt별 구분). step-N은 이벤트 payload 표시용(N4) 유지. ② **DB dedup**: lease PK + `ON CONFLICT (wf,wp) DO NOTHING`로 동시/재진입 중복 디스패치 차단.
5. **이벤트 작성 공통 헬퍼** [설계]. `recordDispatch`/`recordReclaim`/`recordEscalation`가 공유하는 "wp 생명주기 이벤트 + 전이 + outbox 단일 tx 적재"를 `appendWpEvent(client, ...)` 헬퍼로 추출(contract-drift 회피). lease INSERT/UPDATE는 각 메서드 고유.

## 3. 스키마 (migration 008 — 5a)

```sql
-- wp_leases: WP 가시성 타임아웃 lease (가변 프로젝션, 1행/WP). PK가 동시 dispatch dedup 게이트.
CREATE TABLE IF NOT EXISTS wp_leases (
  workflow_id TEXT        NOT NULL,
  wp_id       TEXT        NOT NULL,
  attempt     INT         NOT NULL DEFAULT 0,    -- 디스패치 시도(0=최초). reclaim 시 ++
  owner       TEXT        NULL,                  -- 임대 소유자(워커/에이전트 id). 미배선이라 nullable seam
  status      TEXT        NOT NULL DEFAULT 'active',  -- active | released | escalated (TEXT, 전방호환)
  expires_at  BIGINT      NOT NULL,              -- 가시성 만료(epoch ms) = dispatch occurredAt + visibilityMs
  step_n      INT         NOT NULL DEFAULT 0,    -- 디스패치 시점 topo 인덱스(표시·reclaim 자기완결)
  event_id    UUID        NULL,                  -- 유발 wp.dispatched (provenance, FK 없음 — task_graphs 선례)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workflow_id, wp_id)
);
-- 만료 sweep 조회용(status='active' AND expires_at < now).
CREATE INDEX IF NOT EXISTS idx_wp_leases_sweep ON wp_leases (status, expires_at);
```

`event_id`는 FK 없음(task_graphs.event_id 선례) — lease INSERT를 tx 선두(dedup 게이트)에 두어 manager_events INSERT 순서에 종속되지 않게.

## 4. P1d-5a — lease 획득 on dispatch + §8 하드닝

### 4.1 `recordDispatch` 수정 (`db/dispatch.repo.ts`)

```ts
export interface RecordDispatchInput {
  workflowId: string
  wpId: string
  stepN: number
  fromState: string
  attempt?: number          // 기본 0
  visibilityMs: number      // lease 만료 = occurredAt + visibilityMs
  owner?: string | null
  toState?: string          // 기본 'DISPATCHED'
  causationId?: string | null
  reason?: string | null
}
export type RecordDispatchResult =
  | { status: 'recorded'; eventId: string; seq: number }
  | { status: 'deduped' }   // 이미 lease 존재(동시/재진입) → 무적재
```

**tx 순서**(단일 tx):
1. `INSERT INTO wp_leases (workflow_id, wp_id, attempt, owner, status, expires_at, step_n, event_id) VALUES (...,'active',occurredAt+visibilityMs,...) ON CONFLICT (workflow_id, wp_id) DO NOTHING RETURNING wp_id`. **0행이면**(이미 lease) → ROLLBACK + `{status:'deduped'}`.
2. `appendWpEvent(client, { eventType:'wp.dispatched', toState:'DISPATCHED', fromState, attempt, stepN, ... })` — manager_events + wp_state_log(RETURNING seq) + manager_outbox.
3. COMMIT → `{status:'recorded', eventId, seq}`.

**§8 #1**: `appendWpEvent`가 `stepId='wp-${wpId}'`·`attemptId=attempt`로 봉투 생성 → 멱등키 `{wf}:wp-${wpId}:${attempt}`. payload `{wpId, stepN, attempt}`(step-N 표시 유지).

### 4.2 `appendWpEvent` 헬퍼 (`db/dispatch.repo.ts`, export)

```ts
async function appendWpEvent(client: PoolClient, input: {
  workflowId, wpId, attempt, stepN, eventType, fromState, toState, causationId?, reason?, now,
}): Promise<{ eventId: string; seq: number }>
```
makeEnvelope(stepId=`wp-${wpId}`, attemptId=attempt, occurredAt=now) → manager_events(event_type=eventType) + wp_state_log(from→to, event_id) RETURNING seq + manager_outbox(stream=`manager:events:${wf}`, message). occurred_at 봉투 시각 공유. `recordDispatch`(5a)·`recordReclaim`/`recordEscalation`(5b) 공유.

### 4.3 `handleDispatch` 수정 (`streams/dispatch.ts`)

`DispatchDeps`에 `visibilityMs?`(기본 `DEFAULT_VISIBILITY_MS`) 추가. recordDispatch에 `visibilityMs`·`attempt:0` 전달. 반환이 `deduped`면 dispatched에서 제외(skipped 누적). 그 외 로직 불변.

### 4.4 5a 테스트
- `dispatch.repo.test.ts` 갱신: 멱등키 `wf-1:wp-wp-1:0`(stepId 변경)·payload attempt·**wp_leases INSERT(ON CONFLICT DO NOTHING·expires_at=occurredAt+visibilityMs)**·dedup 시 ROLLBACK+`{status:'deduped'}`. 기존 step-N 키 단언 → WP 키로 정정.
- `dispatch.test.ts` 갱신: handleDispatch가 visibilityMs 전달·deduped를 skipped로 집계.
- 통합 갱신: dispatch 후 `wp_leases` 행(attempt 0·status active·expires_at) 존재.

## 5. P1d-5b — reclaim · escalate sweep

### 5.1 `LeaseStore` (`db/lease.repo.ts`)

```ts
export interface LeaseRecord {
  workflowId: string; wpId: string; attempt: number
  owner: string | null; status: string; expiresAt: number; stepN: number; eventId: string | null
}
export class LeaseStore {
  constructor(pool: Pool, now?: () => number)
  /** status='active' AND expires_at < now (sweep용, LIMIT). 평문 SELECT(자동커밋)이라 행 잠금 없음 —
      동시 sweep 직렬화는 후속 UPDATE의 가드(reclaim=attempt CAS, escalate=status 단방향)가 담당. */
  expiredActiveLeases(now: number, limit?: number): Promise<LeaseRecord[]>
  getLease(workflowId: string, wpId: string): Promise<LeaseRecord | null>
  /** reclaim: lease UPDATE(attempt=next·expires_at·active) + wp.dispatched(attempt next) + 전이 + outbox 단일 tx. */
  recordReclaim(input: { workflowId, wpId, nextAttempt, stepN, visibilityMs, causationId? }): Promise<{ eventId: string; seq: number }>
  /** escalate: lease UPDATE(status='escalated') + wp.escalated + 전이(ESCALATED) + outbox 단일 tx. */
  recordEscalation(input: { workflowId, wpId, attempt, stepN, causationId? }): Promise<{ eventId: string; seq: number }>
}
```
- `recordReclaim`/`recordEscalation`은 `appendWpEvent`(4.2) 재사용. **동시 sweep 직렬화**(0행이면 `{status:'skipped'}`): **reclaim**은 `WHERE status='active' AND attempt = $expectedAttempt`(=nextAttempt−1) **CAS** — 경쟁한 두 번째 reclaim은 attempt가 이미 증가해 0행 skip(reclaim은 status를 active로 유지하므로 status 가드만으론 부족). **escalate**는 `WHERE status='active'`(status='active'→'escalated' 단방향이라 두 번째는 0행 skip). escalate는 lease.event_id를 갱신하지 않음(dispatch provenance 보존).
- escalate 상태: wp_state_log `to_state='ESCALATED'`·event `wp.escalated`·lease `status='escalated'`(P1d-5 신규 상수, TEXT 전방호환).

### 5.2 `planReclaim` 순수 (`streams/lease.ts`)

```ts
export interface ReclaimItem { workflowId: string; wpId: string; stepN: number; action: 'reclaim' | 'escalate'; nextAttempt: number; attempt: number }
export function planReclaim(expired: LeaseRecord[], opts: { maxAttempts: number }): ReclaimItem[]
```
각 만료 lease: `nextAttempt = attempt + 1`. `nextAttempt < maxAttempts`면 `action='reclaim'`, 아니면 `action='escalate'`. (maxAttempts=3 → attempt 0,1 만료=reclaim, 2 만료=escalate. 총 3회 시도.) 순수·결정론(입력 순서 보존).

### 5.3 `handleLeaseSweep` 오케스트레이션 (`streams/lease.ts`)

```ts
export interface SweepDeps { store: LeaseStore; maxAttempts?: number; visibilityMs?: number }
export interface SweepOutcome { reclaimed: Array<{wpId; nextAttempt; eventId}>; escalated: Array<{wpId; eventId}> }
export async function handleLeaseSweep(now: number, deps: SweepDeps): Promise<SweepOutcome>
```
`expiredActiveLeases(now)` → `planReclaim` → 항목별 `recordReclaim`(reclaim)·`recordEscalation`(escalate). handleDispatch 대칭(조회·계획·원자 적재 분리).

### 5.4 5b 테스트
- `lease.repo.test.ts`(mock pool/client): expiredActiveLeases SQL(status='active' AND expires_at<now); recordReclaim tx(lease UPDATE attempt=next + **attempt CAS guard** + appendWpEvent 3-INSERT·멱등키 attempt next); recordEscalation tx(status='escalated' + wp.escalated·to_state ESCALATED); ROLLBACK 가드. 통합: 동시 reclaim(같은 nextAttempt 2회)→두 번째 skipped·중복 wp.dispatched 0(CAS 실증).
- `lease.test.ts`: planReclaim 순수(attempt<max→reclaim·≥max→escalate·경계 maxAttempts·빈 입력); handleLeaseSweep(mock: 만료 분류→recordReclaim/Escalation 호출·outcome 매핑).
- 통합 `lease.integration.test.ts`(skip-if-no-DB): dispatch(5a)→lease 행→`expires_at` 과거로 만료 주입→handleLeaseSweep→attempt 1 reclaim(wp.dispatched·lease attempt++)→재만료·재sweep…→maxAttempts 초과 시 escalate(status='escalated'·wp.escalated). `'wf-lease-%'` 스코프 cleanup + beforeAll 선삭제(형제 격리, P1d-4 §8 #3 선례).

## 6. 멱등·복원력·결정론
- **§8 #1 해소**: 멱등키 WP+attempt 고정(`{wf}:wp-${wpId}:${attempt}`) — 재분해 무관, attempt별 구분.
- **§8 #2 해소**: lease PK + ON CONFLICT DO NOTHING(동시 dispatch dedup). 동시 sweep 직렬화는 reclaim=attempt CAS·escalate=status 단방향 전이(평문 SELECT엔 행 잠금 없음 — UPDATE 가드가 진실원천 무결성 보장).
- **at-least-once 발행**: 기존 OutboxRelay(무수정). reclaim의 attempt++ 봉투로 다운스트림 M6 dedup 키 구분.
- **결정론**: planReclaim 순수. maxAttempts·visibilityMs 주입(env `MANAGER_LEASE_MAX_ATTEMPTS`·`MANAGER_LEASE_VISIBILITY_MS`).

## 7. 회귀·검증
- **5a**: recordDispatch 수정(기존 P1d-4 테스트 갱신 — 멱등키·lease)·handleDispatch 수정. migration 008 추가(runMigrations 자동). `cd xzawedManager && pnpm build && pnpm test`. audit·CPD(appendWpEvent 추출로 중복↓). 적대적 리뷰. PR → CI 그린 → squash.
- **5b**: 신규 lease.repo.ts·lease.ts + 테스트(기존 0줄 수정). 적대적 리뷰. PR → CI 그린 → squash.
- 각 PR 후 CLAUDE.md·메모리 갱신. **다음 P1d-6**(잔여 P1d: 6→7).

## 8. 상수 (`streams/dispatch-constants.ts` 확장)
`ESCALATED_STATE='ESCALATED'`·`WP_ESCALATED_EVENT='wp.escalated'`·`LEASE_ACTIVE='active'`·`LEASE_ESCALATED='escalated'`·`LEASE_RELEASED='released'`·`DEFAULT_VISIBILITY_MS=300_000`(5분)·`DEFAULT_MAX_ATTEMPTS=3` 추가(단일출처). `stepId` 빌더 `wpStepId(wpId)=\`wp-${wpId}\``도 단일출처화(멱등키 §8 #1). env 오버라이드(`MANAGER_LEASE_VISIBILITY_MS`·`MANAGER_LEASE_MAX_ATTEMPTS`)는 배선 시 config.ts에서 주입.
