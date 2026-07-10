# P4-1 실행 워커 골격 (Phase 4a) — 자율 WP 실행 루프 닫기 설계

> Phase 4(검증 오라클·실행 에이전트) **첫 슬라이스(키스톤)**. P1d Task Manager가 만든 자율 루프는 현재
> `decompose → dispatch(wp.dispatched·lease)`까지만 흐르고 **dispatch된 WP를 실제로 수행하는 실행 워커가 없어**
> `wp.completed` 생산자가 비어 있다(P1d-6 완료 소비자는 배선됐으나 입력이 없음). dispatch된 WP는 lease 만료까지 방치된다.
> P4-1은 dispatch된 WP를 owningRole 에이전트로 **자율 실행**하고 완료 신호를 발행해 **루프를 처음으로 end-to-end로 닫는다.**
> senario `ROADMAP.md` Phase 4·`WORKFLOW.md` §B(WP 상태머신)·`VERIFICATION_ADVERSARIAL_STRATEGY.md`의 구체화 1단계.

## 1. 배경 — P1d 루프가 dispatch에서 멈춤

P1d-1~7로 Task Manager는 `decompose → buildTaskGraph → 영속 → readyNodes 디스패치(wp.dispatched·lease 획득) → lease sweep(reclaim/escalate) → completion(lease release·DONE·후행 재디스패치)`를 갖췄다. 그러나:

- **실행 공백**: `wp.dispatched` 후 그 WP를 받아 실제 작업(코드 생성·테스트 등)을 수행하는 **워커가 없다**. dispatch된 WP는 아무도 처리하지 않아 `DEFAULT_VISIBILITY_MS`(5분) lease 만료 → reclaim → 상한 초과 escalate로만 끝난다.
- **`wp.completed` 생산자 부재**: `completion.ts handleCompletion`·`supervisor.ts buildCompletionHandler`(`CompletionSignalSchema`, `manager:completions:main` 소비)는 배선됐으나 **`wp.completion` 신호를 발행하는 주체가 없다**(supervisor.ts §19 주석 "생산자 도착 시 확정").

P4-1 = 이 공백을 메우는 **실행 워커**다. dispatch된 WP를 owningRole 에이전트(기존 7에이전트 중 답변 가능 5종)로 자율 호출하고, 성공 시 `wp.completion` 신호를 발행해 기존 완료 소비자가 루프를 닫게 한다.

## 2. 범위 & 결정 (브레인스토밍 2026-06-09)

**포함**: ①dispatch 트리거 신호(`wp.dispatch_signal`) 발행(`handleDispatch`+`handleLeaseSweep` reclaim) ②`WorkerConsumer`(트리거 소비→owningRole 에이전트 자율 호출→성공 시 `wp.completion` 발행) ③owningRole→핸들러 매핑(`AGENT_TO_TOOL` 재사용) ④WP→에이전트 입력 구성 ⑤`MANAGER_TASK_WORKER` flag + Supervisor 배선.

**제외(후속 Phase 4 슬라이스)**: 실 검증 오라클 실행·step-def 컴파일·mutation·검증 3채널(**4b**) / 결함 국소화·진동 차단·QUARANTINED(**4c**) / Tester·Security 검증 에이전트 통합·`verification.passed|failed`(**4d**) / 풍부한 자율 에이전트 입력·도메인 위키 주입 / 즉시 실패 신호(현재는 lease 타임아웃) / 승인 게이트 통합(자율 경로는 게이트 우회).

### 핵심 결정

1. **자율 에이전트 호출(기존 Claude 루프와 별개 경로)**: 워커가 `RedisAgentHandler.execute(input, sessionId=workflowId)`로 owningRole 에이전트를 직접 호출한다. 기존 대화형 tool-calling 루프(runner.ts·승인 게이트·위키 주입)와 **분리된 자율 실행 경로**. P4-1은 핸들러를 재사용하되 Claude 오케스트레이션·게이트는 거치지 않는다.
2. **실패 = lease 타임아웃 재사용**: 에이전트가 throw(에러 응답·타임아웃)하면 **완료 신호를 발행하지 않는다**. 그러면 기존 P1d-5 lease 만료→`recordReclaim`(attempt++)→상한 초과 `recordEscalation`이 자동 처리. **새 실패 이벤트 0**. 단점(실패 시 5분 대기)은 즉시-실패-신호 최적화(후속)로 개선.
3. **트리거 신호 + 전용 WorkerConsumer(완료-신호 패턴과 대칭)**: dispatch 시 `wp.dispatch_signal`을 공유 스트림 `manager:dispatched:main`에 발행 → `WorkerConsumer`가 소비. 워커는 **트리거 신호만** 주고받고 DB 쓰기는 기존 dispatch/completion 경로가 전담(신호=트리거, 이벤트=audit 진실원천 분리, 기존 완료 흐름과 동형).
4. **reclaim도 트리거**: lease sweep의 `recordReclaim`(attempt++) 재디스패치도 워커가 픽업해야 결정 2의 재시도가 실제 **재실행**된다. `handleLeaseSweep`도 reclaim 성공 후 동일 신호를 발행한다(미발행이면 reclaim이 escalate로만 끝나 재시도 무의미).
5. **신호는 best-effort·lease가 백스톱**: 트리거 신호는 fire-and-forget(outbox 미경유). 유실 시 lease 만료→reclaim→재신호로 복구(at-least-once-ish). 완료 신호도 동형(워커가 fire-and-forget 발행, `handleCompletion`이 M5 outbox 적재).
6. **검증 trivial**: 에이전트 `.execute`가 throw 없이 반환하면 성공으로 간주(실 검증 오라클 실행은 4b). 4a 목표는 **디스패치 언블록과 루프 닫힘**까지.

## 3. 컴포넌트 & 데이터 흐름

```
decompose → handleDispatch ─(recordDispatch: wp.dispatched·lease)─┐
                                                                  ├─▶ wp.dispatch_signal {wpId, attempt}
lease sweep → recordReclaim(attempt++) ───────────────────────────┘     → manager:dispatched:main
                                                                              │
                                              WorkerConsumer ◀────────────────┘
                                                getGraph(wf)→WP 해석→resolveAgentTool(owningRole)
                                                →handler.execute(input, workflowId)
                                                ├─ 성공 → wp.completion {wpId} → manager:completions:main
                                                │            → (기존) handleCompletion: lease release·DISPATCHED→DONE·후행 재디스패치
                                                └─ 실패/타임아웃/미해석 → 신호 미발행 → lease 만료 → reclaim/escalate (재신호)
```

### 3.1 dispatch 트리거 발행 (`streams/dispatch.ts`·`streams/lease.ts`)

- **신호 스키마(`streams/worker.ts` 또는 supervisor 공용)**: `WpDispatchSignalSchema = { envelope: EventEnvelopeSchema, type: z.literal('wp.dispatch_signal'), payload: { wpId: z.string().min(1), attempt: z.number().int().nonnegative() } }`. workflowId는 봉투(`CompletionSignalSchema`와 동형).
- **`handleDispatch`**: `DispatchDeps`에 optional `publish?: Publish`·`dispatchSignalStream?: (channel) => string`(기본 `manager:dispatched:main`) 추가. `recordDispatch` 결과 `status==='recorded'`마다 신호 발행. **`publish` 미주입이면 무발행**(flag off·회귀 0).
- **`handleLeaseSweep`**: 동일 optional `publish` 추가. `recordReclaim` 성공(reclaimed) 항목마다 신호 발행(attempt = 새 attempt). escalate는 신호 없음(재시도 종료).
- 봉투는 `makeEnvelope({correlationId: wf, workflowId: wf, stepId: \`wp.dispatch_signal:${wpId}\`, attemptId: attempt})`. 멱등키 = `{wf}:wp.dispatch_signal:{wpId}:{attempt}` — **(wf, wpId, attempt) 고유**(stepId에 wpId 포함 필수, 미포함 시 같은 workflow·attempt의 여러 WP가 키 충돌). WorkerConsumer dedup 키로 사용: 같은 attempt 중복 신호는 차단, 다른 attempt(reclaim 재시도)는 허용.

### 3.2 실행 워커 (`streams/worker.ts`)

```ts
export interface WorkerDeps {
  repo: TaskGraphRepo                                  // getGraph로 WP 해석
  handlers: Record<string, AgentExecutor>              // tool명(resolveAgentTool 결과) → 핸들러. AgentExecutor={execute(input, sessionId): Promise<unknown>}(ToolHandler 부분구조)
  publish: Publish                                     // wp.completion 발행
  completionStream?: (channel: string) => string       // 기본 manager:completions:main
  buildInput?: (wp: WorkPackage) => unknown             // WP→에이전트 입력(기본 구현 제공)
  now?: () => number
}
export type WorkerOutcome =
  | { status: 'completed'; wpId: string }
  | { status: 'skipped'; reason: 'wp_not_found' | 'unknown_role' | 'no_handler' }
  | { status: 'failed'; reason: 'agent_error' }        // 신호 미발행 → lease 백스톱

export async function handleWpDispatchSignal(msg: WpDispatchSignalMessage, deps: WorkerDeps): Promise<WorkerOutcome>
```

- `getGraph(workflowId)` → `wpId`로 WP 노드 찾음(없으면 `skipped:wp_not_found`).
- `resolveAgentTool(wp.owningRole)`로 핸들러 키 해석(미지·watcher면 `skipped:unknown_role`; 핸들러 미주입이면 `no_handler`).
- `deps.buildInput(wp)`로 입력 구성 → `handler.execute(input, workflowId)`.
  - **성공**(반환) → `wp.completion {envelope(workflowId), type:'wp.completion', payload:{wpId}}` 발행 → `completed`.
  - **throw**(에러·타임아웃·`AgentQueryError`·`ClarificationNeededError` 포함) → 신호 미발행 → `failed`(lease 백스톱이 reclaim).
- **`WorkerConsumer`**(BaseConsumer 서브클래스): `manager:dispatched:main` 구독, group `manager-worker-consumers`, `WpDispatchSignalSchema`, **dedup ON**. `buildWorkerHandler(deps)` 위임(decomposition/completion consumer 패턴 동형).

### 3.3 owningRole→핸들러 매핑 & 입력 구성

- **매핑**: `tools/agent-tool-map.ts AGENT_TO_TOOL`(developer→develop_code·designer→design_ui·tester→run_tests·builder→build_project·security→security_audit; **watcher 제외**) 재사용. decompose `roles` 스테이지가 부여하는 owningRole 값(developer/designer/tester/builder/security)과 정확히 일치. server.ts가 레지스트리 핸들러로 `handlers` 맵 주입.
- **입력 구성(`buildWorkerInput`)**: `tools/runner.ts buildAgentQueryPayload`(답변자 스키마 필수 필드 **합집합** placeholder) 패턴 재사용. WP `acceptanceCriteria`·`storyId`에서 `intent/description` 파생 + 합집합 placeholder. **입력 품질 최소**(4a는 루프 증명; 풍부한 자율 입력·도메인 주입은 후속). Zod object는 미정의 키 strip이라 어느 에이전트로 가도 검증 통과.

### 3.4 Supervisor 배선 (`streams/supervisor.ts`·`server.ts`)

- **`SupervisorComponents.workerConsumer?`**(optional·ConsumerLike) 추가. `createSupervisor`가 `deps.handlers`+`config.taskWorker`일 때만 `WorkerConsumer` 생성·start/stop.
- **`shouldWireWorker(taskWorker: boolean, hasHandlers: boolean): boolean`** 순수 게이트(D4 패턴·`shouldWireOracleConsumer` 동형) + 테스트(`toBeDefined`만으론 미생성 검증 불가).
- **`SupervisorDeps`**에 optional `handlers`·`publish`(이미 있음) 추가. dispatch/sweep 신호 발행을 위해 `DispatchDeps`·`handleLeaseSweep`에 `publish` 합류(taskWorker 활성 시).
- **`server.ts`**: `MANAGER_TASK_WORKER`+pool+Supervisor 배선 시 레지스트리 핸들러 맵을 `createSupervisor`에 주입. flag off면 미배선·신호 미발행.

## 4. 플래그 & 가역성

- **`MANAGER_TASK_WORKER`**(기본 `false`·가역): on이면 `WorkerConsumer` 배선 + `handleDispatch`/`handleLeaseSweep`가 트리거 신호 발행. off면 워커 미배선·신호 미발행·**회귀 0**(dispatch/lease/completion 기존 동작 불변).
- **전제**: `TASK_MANAGER_ENABLED`(Supervisor)+`DATABASE_URL`(getGraph). worker만 켜고 TASK_MANAGER off면 Supervisor 부재로 무의미 — config 주석·warn(D5 패턴).
- 자율 경로는 **승인 게이트를 거치지 않는다**(설계 결정 1). 게이트가 필요한 운영은 기존 대화형 경로 사용(P4-1 범위 밖·문서화).

## 5. 테스트

- **`handleWpDispatchSignal`**(mock deps): 정상→`handler.execute` 호출+`wp.completion` 발행(`completed`) / WP 미발견→`skipped:wp_not_found`·무발행 / 미지 owningRole(watcher 포함)→`skipped:unknown_role`·무발행 / 핸들러 throw→`failed`·**무발행**(lease 백스톱) / owningRole 5종 라우팅 정확.
- **dispatch/sweep 신호 발행**: `publish` 주입 시 `recordDispatch`('recorded')·`recordReclaim`(reclaimed) 후 신호 발행(deduped/escalate는 무발행) / **미주입 시 무발행(회귀 0)**.
- **`shouldWireWorker`** 진리표(F/T·T/F·F/F·T/T) + `createSupervisor` workerConsumer 조립.
- **입력 구성**: `buildWorkerInput`이 답변자 스키마 합집합으로 유효 입력 산출(5종 safeParse 통과).
- **회귀 0**: 기존 dispatch·lease·completion·supervisor 테스트 무회귀(신호·optional 인자 additive).
- **config**: `MANAGER_TASK_WORKER` 기본 false·`'true'`→true.
- **(선택) 통합(skip-if-no-DB)**: dispatch_signal→mock handler→wp.completion→handleCompletion→DONE·후행 재디스패치 루프를 실 pg로 실증.

## 6. 위험 & 완화

- **트리거 신호 유실**(fire-and-forget·크래시): dispatch 후 신호 발행 전 크래시 시 WP가 워커에 미도달 → **lease 만료→reclaim→재신호**가 백스톱(at-least-once-ish). 완료 신호 유실도 동형(lease 만료→reclaim 재실행). 결정 5.
- **자율 입력 품질**: WP→에이전트 입력이 최소라 에이전트 산출 품질이 낮을 수 있음. 4a는 **루프 닫힘**이 목표(N1 실 검증은 4b가 게이트). 풍부한 입력·도메인 주입은 후속.
- **실패 5분 대기**: 실패가 lease 타임아웃(5분)으로만 감지됨(결정 2). 즉시-실패-신호는 후속 최적화. `MANAGER_LEASE_VISIBILITY_MS`로 단축 가능.
- **중복 실행(비멱등)**: reclaim 재시도·중복 신호는 같은 WP를 다시 실행(에이전트 부수효과 비멱등). BaseConsumer dedup(attempt별 멱등키)이 **같은 attempt 중복 신호**는 차단하나, attempt가 다른 reclaim 재실행은 의도적 재시도. 핸들러 트랜잭션 멱등은 범위 밖.
- **게이트 우회**: 자율 경로는 승인 게이트를 거치지 않음(결정 1). 위험 작업의 게이트 필요 시 대화형 경로 — 자율 경로 게이트 통합은 후속.
- **검증 공백(trivial)**: 에이전트 무에러 반환=성공이라 **잘못된 산출물도 완료로 통과**할 수 있음. 4b 실 검증 오라클이 이 게이트를 채운다(현재는 의도된 한계·문서화).
- **실 워크스페이스 경로 부재(적대 재리뷰 NEW-2·핵심 한계)**: execute 모드에서 에이전트는 `projectPath`를 `fs.realpath`로 검증한다(워크스페이스 루트 기준 상대·`''`는 ENOENT 거부). 워커는 WP/그래프만으로 **유효한 워크스페이스 경로를 만들 수 없다**(WP에 projectPath 없음). `'.'`(워크스페이스 루트)는 에이전트 cwd=workspaceRoot 배포에서만 통과 — 그 외엔 거부→에러→lease 백스톱→escalate. ⇒ **루프 메커니즘(신호→워커→완료→DONE→재디스패치)은 통합테스트(mock 에이전트)로 실증되나, 실 에이전트 성공 완료는 워크플로→프로젝트 워크스페이스 컨텍스트 주입(후속)을 전제로 한다.** developer는 `plan`, tester/builder/security는 워크스페이스를 읽으므로 경로 유효성이 실행 성공의 관건.
- **stale-attempt 완료(적대 재리뷰 NEW-1)**: 느린 attempt0 완료가 reclaim 후 attempt1 lease에 도착하면 `handleCompletion`이 현재 lease를 완료시킨다. **terminal 상태는 항상 정확**(완료 신호=실제 에이전트 성공이므로 DONE 타당)하나, in-flight attempt1 재실행이 낭비된다(위 "중복 실행" 범주). 정밀 attempt-매칭 가드(`envelope.attemptId===lease.attempt`일 때만 완료)는 P1d-6 `handleCompletion`/`completion-consumer` 변경을 수반하므로 **후속**(현 동작은 손실·stuck 없음).

## 7. 완료 정의 (수용 기준)

①`handleWpDispatchSignal`(성공→완료 발행·실패/미해석→무발행)+테스트 ②dispatch/sweep 트리거 신호 발행(`publish` 주입 시·미주입 회귀 0)+테스트 ③owningRole→핸들러 매핑(`AGENT_TO_TOOL` 재사용)·입력 구성+테스트 ④`WorkerConsumer`+`shouldWireWorker` 순수 게이트+테스트 ⑤`MANAGER_TASK_WORKER` flag+Supervisor/server 배선(off 회귀 0) ⑥문서 최신화(CLAUDE.md root/manager·docs) ⑦build·test·jscpd 0·audit 0.
