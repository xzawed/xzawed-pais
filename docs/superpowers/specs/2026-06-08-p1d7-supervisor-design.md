# P1d-7 Supervisor 런타임 배선 (consume→dispatch · sweep · completion→re-dispatch) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 1 — **P1d 결정론적 Task Manager**의 **마지막 슬라이스(7/7)**. P1d-1~6(코어 전체) 다음. **첫 배선 슬라이스**(server.ts 수정).

## 1. 목표 & 비범위

P1d-1~6의 핵심 핸들러(`handleDecompositionEmitted`·`handleDispatch`·`handleLeaseSweep`·`handleCompletion`)를 **`Supervisor`로 묶어 server.ts에 flag 뒤로 배선**한다. 생산자(P2 PM 분해·워커 완료 신호)가 없어 빈 스트림을 구독하지만 **동작 준비 완료**(P2 도착 시 즉시 동작). lease sweep은 생산자 불요라 즉시 유효.

**범위**: `Supervisor`(생명주기 코디네이터) + `LeaseSweeper`(타이머) + decomposition/completion 핸들러 팩토리 + `CompletionSignalSchema` + config flag/env + server.ts 배선. `DecompositionConsumer`에 `afterPersisted` 훅 추가(additive).

**비범위(엄격 제외)**: **P2 생산자**(decomposition.emitted 발행=PM 분해)·**워커 완료 신호 생산자**·**§8 멱등키 해소**(생명주기 이벤트 dedup — 별도/후속)·**escalate 후 사람 재개입 UI**·실제 에이전트 tool-calling 연결·다중 Supervisor 인스턴스 동시성(단일 인스턴스 전제). flag off면 현재 동작 100% 보존.

## 2. 설계 결정 (PO 승인)

1. **gate flag = `TASK_MANAGER_ENABLED`(기본 false·가역)** [PO]. true + `DATABASE_URL`이면 Supervisor 배선. EVENT_SOURCED_SESSION과 동일 패턴(z transform boolean). off/no-DB면 미배선(핸들러만 존재).
2. **구독 = shared 단일 스트림** [PO]. `manager:decomposition`·`manager:completions` 단일 스트림(컨슈머그룹 1개), `workflowId`는 봉투(`envelope.workflowId`)에서 추출. gateway·per-workflow 생명주기 불요(Task Manager는 중앙 오케스트레이터라 세션당 고립 불요). BaseConsumer는 `start(channel)`로 고정 채널(`main`) 구독.
3. **배선 범위 = 3종 전부** [PO]. ① decomposition 소비→`handleDecompositionEmitted`(영속)→영속 성공 시 `handleDispatch`(디스패치) ② `LeaseSweeper`(setInterval→`handleLeaseSweep`) ③ completion 소비→`handleCompletion`(재디스패치).
4. **sweep 주기 = `MANAGER_LEASE_SWEEP_MS`(기본 30000)** [PO]. visibility 5분 대비 충분. env 오버라이드.
5. **단일 인스턴스 전제** [설계]. LeaseSweeper 재진입 가드(OutboxRelay 선례). 다중 인스턴스 동시 sweep(reclaim CAS·escalate status 단방향이 일부 보호하나 완전 직렬화는 advisory lock 후속)은 비범위.

## 3. 컴포넌트

### 3.1 config (`config.ts`)
- `TASK_MANAGER_ENABLED`: z transform boolean(기본 false, EVENT_SOURCED_SESSION 패턴).
- `MANAGER_LEASE_SWEEP_MS`: z.coerce.number().int().positive().default(30000).
- `MANAGER_LEASE_VISIBILITY_MS`: default 300000. `MANAGER_LEASE_MAX_ATTEMPTS`: default 3.

### 3.2 `LeaseSweeper` (`streams/lease-sweeper.ts`)
OutboxRelay 패턴. `setInterval(sweepMs)` 폴러 + 재진입 가드. `pollOnce()` → `handleLeaseSweep(now(), { store, maxAttempts, visibilityMs })`. 실패는 경고 후 계속(never-throw). `start()`/`stop()`. `now: () => number = Date.now`(테스트 주입).

```ts
export interface LeaseSweeperDeps { store: LeaseStore; maxAttempts: number; visibilityMs: number }
export class LeaseSweeper {
  constructor(deps: LeaseSweeperDeps, sweepMs?: number, now?: () => number)
  start(): void; stop(): void; pollOnce(): Promise<void>
}
```

### 3.3 핸들러 팩토리 + completion 스키마 (`streams/supervisor.ts`)

```ts
// decomposition 소비 핸들러: 영속 → 영속 성공 시 디스패치
export function buildDecompositionHandler(deps: { repo, store, publish, visibilityMs }):
  (msg: DecompositionEmittedMessage) => Promise<void>
// completion 신호 스키마(잠정 — 워커 생산자 도착 시 확정)
export const CompletionSignalSchema = z.object({
  envelope: EventEnvelopeSchema, type: z.literal('wp.completion'), payload: z.object({ wpId: z.string().min(1) }),
})
export type CompletionSignalMessage = z.infer<typeof CompletionSignalSchema>
// completion 소비 핸들러: handleCompletion(재디스패치)
export function buildCompletionHandler(deps: { leaseStore, dispatch }):
  (msg: CompletionSignalMessage) => Promise<void>
```
- `buildDecompositionHandler`: `handleDecompositionEmitted(msg, {repo, publish})` → `status==='persisted'`면 `handleDispatch(msg.envelope.workflowId, {repo, store, visibilityMs})`. (inconsistent는 publish로 이미 에스컬레이션.)
- `buildCompletionHandler`: `handleCompletion(msg.envelope.workflowId, msg.payload.wpId, {leaseStore, dispatch})`.

### 3.4 `DecompositionConsumer` 훅 추가 (`streams/decomposition-consumer.ts`, additive)
생성자에 optional `afterPersisted?: (workflowId: string) => Promise<void>` 추가. 핸들러: `const o = await handleDecompositionEmitted(...); if (o.status==='persisted' && afterPersisted) await afterPersisted(msg.envelope.workflowId)`. 기존 호출(훅 미전달)은 동작 불변(P1d-2 회귀 0). Supervisor가 `afterPersisted = wf => handleDispatch(wf, dispatchDeps)` 주입.

> 대안 기각: Supervisor가 별도 BaseConsumer 생성 → 같은 스트림/스키마 이중 소비자(contract-drift). 훅이 DRY.

### 3.5 `Supervisor` (`streams/supervisor.ts`)
생명주기 코디네이터(injected 컴포넌트 over). 테스트 용이.

```ts
export interface SupervisorComponents {
  decompositionConsumer: { start: (ch: string) => Promise<void>; stop: () => void }
  completionConsumer: { start: (ch: string) => Promise<void>; stop: () => void }
  leaseSweeper: { start: () => void; stop: () => void }
}
export class Supervisor {
  constructor(components: SupervisorComponents, channel?: string /* 기본 'main' */)
  start(): void  // 두 consumer.start(channel)(비동기·void), leaseSweeper.start()
  stop(): void   // 전부 stop()
}
// 실 컴포넌트 조립 팩토리(server.ts용)
export function createSupervisor(redis: Redis, deps: { repo, dispatchStore, leaseStore, publish }, config:
  { sweepMs, visibilityMs, maxAttempts }): Supervisor
```
- `createSupervisor`: `DecompositionConsumer`(repo·publish·afterPersisted=handleDispatch) + completion `BaseConsumer`(buildCompletionHandler·CompletionSignalSchema) + `LeaseSweeper` 조립.

### 3.6 server.ts 배선
`config.TASK_MANAGER_ENABLED && pool`이면: `RedisEventBus.publish` 바인딩 + repos/stores 생성 → `createSupervisor(redis, {...}, {...})` → `supervisor.start()`. `closeAll`에 `supervisor?.stop()`. no-DB·off면 미생성(현 동작 보존). DATABASE_URL 있고 flag만 off면 핸들러 미배선.

## 4. 데이터 흐름
(P2 도착 후) decomposition.emitted→`manager:decomposition:main`→소비→영속→디스패치(wp.dispatched + lease). 30s마다 sweep→만료 lease reclaim/escalate. 워커 완료→`manager:completions:main`→소비→handleCompletion(lease release·DONE·후행 재디스패치). 모든 발행은 OutboxRelay 경유(기존).

## 5. 에러·복원력
- 소비자: BaseConsumer 바운드 재시도+DLQ+멱등(P1a/P1b) 그대로. LeaseSweeper: never-throw·재진입 가드.
- flag off/no-DB: Supervisor 미생성 → 회귀 0.
- 단일 인스턴스 전제(다중 sweep advisory lock은 후속). ⚠️ §8 생명주기 이벤트 멱등키 공유(P1d-6 §8)는 `manager:events` 소비자 배선 시 해소 필요(본 슬라이스는 그 소비자 미배선).

## 6. 테스트 (TDD)
- **`lease-sweeper.test.ts`**: pollOnce→handleLeaseSweep 호출(now·deps 전달)·재진입 가드(동시 pollOnce 1회)·실패 시 never-throw·start/stop 타이머.
- **`supervisor.test.ts`**: buildDecompositionHandler(영속 성공→handleDispatch 호출·inconsistent→미호출, mock); buildCompletionHandler(handleCompletion 호출); CompletionSignalSchema 검증; Supervisor.start/stop이 주입 컴포넌트 start/stop 호출.
- **`decomposition-consumer.test.ts`** +afterPersisted: persisted면 훅 호출·inconsistent면 미호출·훅 미전달 시 불변(회귀).
- **server.ts**: flag on+pool이면 Supervisor 생성·start, off면 미생성(기존 server 테스트 패턴). 통합은 선택(실 Redis 필요).

## 7. 회귀·검증
flag off 기본이라 회귀 0. DecompositionConsumer 훅 additive. `cd xzawedManager && pnpm build && pnpm test`. audit·CPD. 적대적 리뷰(생명주기·flag 가역·빈 스트림 안전·sweep 재진입·핸들러 합성·회귀). PR → CI 그린(재실행 플레이크 주의) → squash. CLAUDE.md(구조·env·Supervisor 섹션)·메모리 갱신. **P1d 7/7 완료** → 다음 Phase(P2 분해 파이프라인 등).
