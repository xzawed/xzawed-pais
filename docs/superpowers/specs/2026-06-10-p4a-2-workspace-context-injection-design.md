# P4a-2 — 실행 워커 워크스페이스 컨텍스트 주입 설계

날짜: 2026-06-10
선행: P4-1 실행 워커 골격(#269, [2026-06-09-p4-1-execution-worker-design.md](2026-06-09-p4-1-execution-worker-design.md) §6 "실 워크스페이스 경로 부재" 재리뷰 NEW-2)
범위: xzawedManager 단독 (xzawedShared·에이전트 서비스 무수정)

## 1. 목표 / 비범위

**목표**: P4-1 워커의 에이전트 입력이 placeholder 품질(`projectPath: '.'`·`context: {}`)이라 실 에이전트가
경로 검증(`fs.realpath`)에서 거부되는 한계(NEW-2)를 해소한다. 분해 시점의 워크스페이스 컨텍스트
(`UserContext`)를 Task Graph에 영속하고, 워커가 에이전트 자율 호출 시 이를 주입해 **실 에이전트 성공
완료가 성립**하게 만든다.

**비범위**:
- 실 검증 오라클(4b) — 완료 판정은 여전히 trivial(무예외=성공).
- Orchestrator 측 decompose_request 트리거 UX(별도 슬라이스) — 계약만 additive로 연다.
- 도메인 위키 주입 등 풍부한 에이전트 입력(P4-1 §6 후속의 나머지).
- WP별 세분화된 projectPath(서브디렉토리 라우팅) — 워크플로 단위 워크스페이스만.

## 2. 핵심 결정

| # | 결정 | 근거 |
|---|------|------|
| 1 | 컨텍스트 단위 = **워크플로(그래프)**, WP 아님 | 분해 1회 = 프로젝트 1개. WP에 넣으면 contentHashId(§6 P7 안정 ID — storyId·owningRole·AC만 해싱)와 무관하나 중복 저장·드리프트만 늘림 |
| 2 | 영속 위치 = `task_graphs.graph_dag` JSONB 내부 `userContext` 키 | **migration 0** — JSONB additive. 가변 프로젝션 의미(재분해 시 최신 컨텍스트로 교체)와 일치 |
| 3 | 전달 형태 = 기존 `UserContext` 재사용(`userId`·`projectId`·`workspaceRoot`·`githubRepo?`) | `RedisAgentHandler.execute(input, sessionId, **userContext?**)`가 이미 3번째 인자로 받아 payload에 spread → 에이전트가 `resolveWorkspaceRoot(payload.userContext, config.workspaceRoot)`로 소비. **에이전트 계약 무변경** |
| 4 | 워커 입력 `projectPath` = `userContext.workspaceRoot`(절대경로), 미존재 시 기존 `'.'` 폴백 | builder/tester `validatePath`는 `fs.realpath(projectPath)`를 **에이전트 프로세스 cwd 기준**으로 해석 — `'.'`는 cwd≠workspaceRoot 배포에서 거부(NEW-2의 실체). 절대경로는 cwd 무관, `path.relative(realRoot, realProject)=''`로 containment 통과 |
| 5 | `decompose_request.payload.userContext` = **optional additive** | task_request와 대칭. 기존 발행자(테스트·수동) 무영향·회귀 0 |
| 6 | decompose 경로도 `ensureWorkspace(userContext)` 수행(트리거 try 안) | task_request 경로와 대칭 — 검증(`validateWorkspaceRoot`)+mkdir로 에이전트 실행 전 워크스페이스 존재 보장. trigger의 try 안에서 호출해 실패 시에도 finally cleanup 보장 |
| 7 | `getGraph`의 userContext 파싱은 **safeParse → 실패 시 null** (tolerant) | 레거시 행(키 없음)·손상 데이터가 getGraph 전체(디스패치 경로 포함)를 깨면 안 됨. 워커는 null이면 placeholder 폴백(우아한 강등 — lease 백스톱 보존) |

## 3. 변경 상세 (데이터 흐름 순)

```
decompose_request {intent, userContext?}                        ← (1) 계약 additive
  → sessions.route: handleDecomposeRequest(..., userContext?)   ← (2) 라우트 스레딩
  → trigger: ensureWorkspace(userContext) → produceDecomposition(..., userContext?)  ← (3)
  → decomposition.emitted payload {workPackages, oracleDrafts, userContext?}         ← (4) 발행 additive
  → handleDecompositionEmitted → upsertGraph({..., userContext})                     ← (5) 소비·영속
  → task_graphs.graph_dag = {workPackages, userContext?}        ← migration 0
  → worker: getGraph().userContext → buildWorkerInput(wp, uc) + handler.execute(input, wf, uc)  ← (6)
  → RedisAgentHandler가 payload.userContext로 spread → 에이전트 resolveWorkspaceRoot 소비(기존 경로)
```

1. **`streams/consumer.ts` + `types/streams.ts`**: `DecomposeRequestSchema.payload`에
   `userContext: UserContextSchema.optional()` 추가. `DecomposeRequestMessage` 타입 동기.
2. **`api/sessions.route.ts`**: decompose 분기가 `msg.payload.userContext`를 `handleDecomposeRequest`에 전달.
3. **`decompose/trigger.ts`**: `handleDecomposeRequest(..., userContext?, ensureWs = ensureWorkspace)` —
   try 안에서 `userContext` 존재 시 `ensureWs(userContext)` 후 `produceDecomposition`에 전달.
   `ensureWs` 주입은 테스트용(기본 = 실 구현).
4. **`decompose/producer.ts`**: `produceDecomposition(intent, workflowId, deps, userContext?)` —
   `emitWorkPackages`가 ok·기술 fallback 경로 모두 `...(userContext && { userContext })`를 payload에 포함.
   inconsistent 경로는 그래프 미영속이므로 미포함.
5. **`streams/decomposition-consumer.ts` + `db/task-graph.repo.ts`**:
   - `DecompositionEmittedSchema.payload`에 `userContext: UserContextSchema.optional()`.
   - `handleDecompositionEmitted`가 `upsertGraph({..., userContext: msg.payload.userContext ?? null})`.
   - `PersistGraphInput.userContext?: UserContext | null`, `StoredGraph.userContext: UserContext | null`.
   - `upsertGraph`: `graph_dag = JSON.stringify({workPackages, ...(userContext && {userContext})})`.
   - `getGraph`: `UserContextSchema.safeParse(row.graph_dag?.userContext)` 성공 시 채움, 아니면 null.
6. **`streams/worker.ts`**:
   - `AgentExecutor.execute(input, sessionId, userContext?)` — optional 3번째 인자(구조적으로
     `ToolHandler.execute` 2-인자 함수도 할당 가능 → server.ts 핸들러 맵 무수정).
   - `buildWorkerInput(wp, userContext?)`: `projectPath = userContext?.workspaceRoot ?? '.'`,
     나머지 union placeholder 유지. `WorkerDeps.buildInput` 시그니처 동기.
   - `handleWpDispatchSignal`: `stored.userContext`를 `buildInput`과 `handler.execute` 3번째 인자에 전달.

## 4. 회귀 0 논거

- 모든 스키마 변경 additive optional — 기존 메시지·기존 graph_dag 행은 그대로 파싱(레거시 행은 userContext 없음 → null).
- userContext 미존재 시 워커 동작은 P4-1과 바이트 단위 동일(projectPath '.'·execute 2-인자 의미).
- `MANAGER_TASK_WORKER`·`MANAGER_DECOMPOSE_ENABLED` off면 이 경로 자체가 미배선(기존 flag 게이트 보존).
- 대화형(task_request) 경로 무접촉.

## 5. 테스트 전략

- **consumer.test.ts**: decompose_request + userContext 파싱(유효·생략·불량 거부).
- **trigger.test.ts**: userContext 존재 시 ensureWs 호출·produceDecomposition에 전달 / 부재 시 미호출 /
  ensureWs throw 시 cleanup 보장(finally).
- **producer.test.ts**: ok·fallback 경로 payload에 userContext 포함 / 미전달 시 키 부재.
- **decomposition-consumer.test.ts**: emitted+userContext → upsertGraph 인자 포함 / 부재 → null.
- **task-graph repo (유닛 + 통합 skip-if-no-DB)**: upsert→getGraph 라운드트립 / 레거시 행(키 없음) null /
  손상 userContext safeParse null.
- **worker.test.ts**: stored.userContext 존재 시 execute 3번째 인자 전달 + projectPath=workspaceRoot /
  부재 시 기존 동작('.'·undefined).

## 6. 한계 / 후속 (적대적 리뷰 28에이전트 반영 후)

리뷰에서 확정된 3건은 본 슬라이스에서 수정 완료: ① workspaceRoot **절대경로 강제**(`AbsoluteUserContextSchema`
refine — decompose_request·emitted·getGraph 3지점, 상대경로는 Zod 거부/null 강등 — developer false-success 차단)
② **trigger 실패 무응답 해소**(catch→`type:'error'` 발행→rethrow, task_request 대칭·M8) ③ **intent 4000자
클램프**(planner/designer `.max(4000)` 정합·plan은 무손실).

잔여 한계:

- **재분해 시 컨텍스트 유실 가능**: 이후 decompose_request가 userContext 없이 오면 graph_dag 교체로
  null이 된다(가변 프로젝션 의미상 의도). 운영에선 트리거 UX(후속)가 항상 채우는 것으로 해소.
- **재분해 자체가 M6 dedup에 24h 차단(기존·P3-2 §6 blocker#4 인계)**: producer가 `attemptId: 0` 고정으로
  emit하므로 같은 workflowId 재분해의 idempotencyKey가 동일 — DecompositionConsumer dedup(TTL 24h)이
  의미적 재분해를 전달-중복으로 오인해 skip한다. 컨텍스트 교체 의미론도 그 동안 무효. **재분해 트리거 배선
  슬라이스에서 분해 시도별 attemptId 증가(또는 eventId 기반 dedup 키)로 해소** — 본 슬라이스 범위 밖.
- **신뢰 경계 가정**: `validateWorkspaceRoot`는 컨테인먼트(샌드박스 프리픽스) 검사가 아니다 — 절대경로면
  fs 루트 외 어디든 통과한다. decompose_request 발행자(Orchestrator)는 신뢰 주체이고 최종 백스톱은 각
  에이전트의 `WORKSPACE_ROOT` 가드(`validatePath` containment)다. 신뢰 베이스 하위 강제(예: projectId
  파생 경로)는 P5 릴리스 게이트/RBAC(#6)와 함께 재검토.
- **Manager 통합 테스트 CI 미실행(기존·전 슬라이스 공통)**: ci.yml turborepo 잡은 `TEST_DATABASE_URL`만
  설정하나 Manager 통합 테스트 8파일은 `DATABASE_URL`로 게이트 — skip-if-no-DB가 CI에서도 항상 skip.
  게이트 통일(`TEST_DATABASE_URL ?? DATABASE_URL`)+비스코프 DELETE cleanup의 prefix 스코프화(P1d-4 §8.3)를
  묶은 **별도 후속 PR**로 해소(활성화 시 병렬 flake 위험을 함께 제거해야 함).
- **dispatch_signal 자체에는 컨텍스트 없음**: 워커가 매 신호마다 getGraph로 조회(이미 WP 해석에 필요해
  추가 조회 0). 신호 페이로드 확장은 불필요로 판단.
- **에이전트별 의미 차이**: developer는 workspaceRoot(파일 I/O)+projectPath(프롬프트), builder/tester는
  projectPath(realpath 검증·명령 cwd)+workspaceRoot(containment 상한). 본 슬라이스는 워크플로
  워크스페이스 루트=프로젝트 루트 가정 — 모노레포 서브프로젝트 라우팅은 후속.
- **검증 trivial 유지**: 실 에이전트가 성공해도 산출물 품질 검증은 4b.
- planner(plan_task)는 워커 핸들러 5종에 없음(P4-1 결정 유지) — pm/planner 소유 WP는 여전히 escalate.
