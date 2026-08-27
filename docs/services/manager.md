# xzawedManager

Orchestrator의 지시를 받아 Claude tool-calling 루프로 전문 에이전트에 위임하는 서비스.

**포트:** 3001

---

## 개요

`orchestrator:to-manager:{sessionId}`에서 `task_request`를 받으면 tool-calling 루프를 시작한다. Claude가 도구를 고르면 해당 ToolHandler가 대상 에이전트 스트림에 요청을 발행하고 응답을 기다리며, 도구 실행 전후로 `status_update`를 Orchestrator에 보낸다.

루프 상한은 `MANAGER_MAX_ITERATIONS`이고 **기본 50**이다(`claude/runner.ts` `parseMaxIterations`). 상수가 아니라 env로 조정된다.

대화형 루프 밖의 자율 아크(Task Graph·분해·검증 채널·의사결정·리스크·릴리스)는 **전부 플래그 뒤에 있고 기본 off**다. 무엇이 켜져 있고 무엇이 휴면인지는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)가 단일 진실원천이다 — 여기 복제하지 않는다. 서브시스템 **지도는 바로 아래**에 있고, 각각의 **함정**은 [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md)에 있다.

---

## src/ 책임 지도

| 경로 | 책임 |
|---|---|
| `claude/runner.ts` | tool-calling 루프. 승인 게이트·도메인 위키 주입·교차질의 라우팅·서킷브레이커가 여기 붙는다 |
| `tools/` | ToolHandler 레지스트리. `redis-agent-handler.ts`가 7개 에이전트 RPC를 담당 |
| `gates/approval-gate.ts` | 승인 게이트 순수 모듈(`effectiveMode`·`parseDecision`·`GATED_TOOLS`·`DEPLOY_TOOLS`) |
| `decompose/` | **분해 생산자.** `pipeline.ts`의 다단계 LLM 분해와 `map.ts`의 WorkPackage 매핑. 소비는 `streams/`가 한다 |
| `streams/` | Supervisor와 소비자들. 디스패치·lease·워커·검증·결정·리스크·릴리스·강등 |
| `db/` | 저장소 계층 + `migrations/`. `oracle`·`decision`·`advisory`의 `*.types.ts`는 Zod 정본이지만 `release-gate.types.ts`는 TS 인터페이스, `risk-classification.types.ts`는 이벤트 상수다(아티팩트 스키마는 shared에 있다) |
| `api/` | `sessions`·`knowledge`·`decision`·`oracle`·`risk`·`admin`·`health` 라우트 |

## 자율 아크 서브시스템 지도

기본값은 **대화형 챗 + 사람 승인 게이트**다. 아래 서브시스템은 전부 플래그 뒤에 있고 기본 off다. 무엇이 켜져 있는지는 [`docs/LIVE_VS_FLAGGED.md`](../LIVE_VS_FLAGGED.md)를 본다.

| 서브시스템 | 하는 일 | 코드 |
|---|---|---|
| 이벤트소싱·아웃박스 | append-only 이벤트가 진실원천, 상태는 replay로 파생. 상태변경과 발행을 단일 tx로 원자화(dual-write 금지) | `db/event-store.ts` · `streams/outbox-relay.ts` |
| 분해 | 요청 → epics → story → deliverable → WorkPackage. 실패 시 자가수선 후 소진되면 사람에게 에스컬레이션 | `decompose/pipeline.ts` · `streams/decomposition-consumer.ts` |
| Task Graph | WP 그래프 영속(가변 프로젝션 + append-only 상태 로그). WP id는 content-hash라 재진입해도 불변 | `db/task-graph.repo.ts` |
| 디스패치 · Lease | ready WP를 에이전트에 할당하고 가시성 타임아웃으로 회수. 만료 sweep이 attempt를 올리고 상한 초과 시 에스컬레이션 | `db/dispatch.repo.ts` · `db/lease.repo.ts` |
| 실행 워커 | 할당된 WP를 owningRole 에이전트로 자율 실행하고 완료를 발행 | `streams/worker.ts` |
| 검증 게이트 | 완료를 **실행 결과로만** 판정한다. LLM 선언은 근거가 아니다 | `streams/verify.ts` |
| 오라클 | GWT 시나리오·불변식 초안을 생성하고 **사람 승인**을 거쳐 검증 입력이 된다 | `db/oracle.repo.ts` |
| 의사결정 영속 | 사람 결정을 append-only·비부인으로 영속. 만료 sweep과 바운드 재에스컬레이션 포함 | `db/decision.repo.ts` |
| 리스크 분류 | 프로젝트 intent를 4차원 조사 → 점수화 → **사람 승인 후에만** 라우팅 확정 | `streams/risk-*.ts` |
| 릴리스 · 배포 게이트 | WP별 검증 증거를 집계해 릴리스를 판정하고, 배포의 하드 전제로 건다 | `streams/release-gate.ts` · `tools/deploy-gate.ts` |
| 운영 강등 모드 | NORMAL/DEGRADED/SAFE를 신호로 추적하고 디스패치를 보류·재개한다 | `streams/mode-controller.ts` |

검증 게이트의 다섯 채널(파생·conformance·impact·property·security)은 전부 **hard-AND**다. 하나라도 실패하면 완료를 발행하지 않고 lease 백스톱이 회수한다. 채널별 판정 기준은 `streams/verify.ts`의 `judgePrimaryResult`가 단일 지점이다.

## Redis Streams 인터페이스

봉투 5필드·소비자 그룹·DLQ 실패 의미론은 [redis-envelope.md](../spec/redis-envelope.md)가, 에이전트 RPC 계약은 [agent-rpc.md](../spec/agent-rpc.md)가 갖는다. 여기엔 이 서비스의 payload 모양만 둔다.

### 수신 — `orchestrator:to-manager:{sessionId}`

Consumer Group `manager-consumers`. 정본은 `types/streams.ts`의 `OrchestratorMessageType`이고 **4종**이다.

| `type` | payload | 비고 |
|---|---|---|
| `task_request` | `{ intent, context, priority, userContext?, gateMode? }` | `gateMode`는 전역 승인 게이트 기본 모드 |
| `info_response` | `{ answer }` | `answer`가 승인 게이트 응답이면 JSON 결정으로 해석 — `{ decision: 'approve'\|'revise'\|'abort', rememberAuto?, saveToWiki?, wikiSummary?, feedback? }`. 파싱 불가·미지 값은 fail-safe 기본값에서 자동 승인이 아니라 `needs_human` 에스컬레이션이 된다 |
| `abort` | `{}` | |
| `decompose_request` | `{ intent, userContext? }` | `MANAGER_DECOMPOSE_ENABLED`가 꺼져 있으면 명시 `error`를 발행한다(무음 drop 금지). **`userContext`가 여기서만 더 엄격하다** — `AbsoluteUserContextSchema`라 상대 `workspaceRoot`는 Zod에서 거부돼 DLQ로 간다(false-success 방지) |

`UserContext`는 `{ userId, projectId, workspaceRoot, tenantId?, githubRepo? }`다. **`tenantId`는 에이전트에 도달하지 않는다** — 에이전트 복제 스키마에 필드가 없어 Zod strip으로 소실된다(근거는 [agent-rpc.md](../spec/agent-rpc.md)).

미지 `type`은 Zod union에서 걸러져 DLQ로 격리된다.

### 발신 — `manager:to-orchestrator:{sessionId}`

정본은 `types/streams.ts`의 `ManagerMessageType`이고 **5종**이다.

| `type` | 발행 지점 |
|---|---|
| `status_update` | `claude/runner.ts` — 도구 실행 전후, 잘못된 도구 입력, `design_ui` 완료(`uiSpec` 동봉), `end_turn` |
| `info_request` | `claude/runner.ts` — `request_info` 도구 · 승인 게이트 · 명확화(`ClarificationNeededError`). **교차질의는 여기 없다** — `AgentQueryError`는 다른 에이전트 도구를 호출해 재실행한다 |
| `task_complete` | `api/sessions.route.ts` · `decompose/trigger.ts` |
| `error` | `api/sessions.route.ts` · `decompose/trigger.ts` · `server.ts` |
| `knowledge_changed` | `claude/runner.ts` — 위키 변경 알림(WikiPanel 실시간 갱신용·비차단) |

---

## 도구

레지스트리 등록은 **항상 9개 + `GITHUB_TOKEN` 시 2개 = 최대 11개**이고, Claude API에 실리는 배열은 그때그때 다르다.

| 도구 | 대상 | 등록 조건 |
|---|---|---|
| `plan_task` · `develop_code` · `design_ui` · `run_tests` · `build_project` · `watch_changes` · `security_audit` | 에이전트 7종 | 항상 |
| `register_project` · `switch_project` | Manager 자체 | 항상 |
| `github_ops` · `deploy_project` | Manager 자체 | **`GITHUB_TOKEN` 설정 시에만** |

호출 시점에 `request_info`가 덧붙고, `userContext.workspaceRoot`가 이미 있으면 `register_project`가 빠진다(LLM의 불필요한 호출 방지). 그래서 실제 API 배열은 고정 11이 아니다.

도구별 요청·완료 타입은 [agent-rpc.md](../spec/agent-rpc.md)에, 필드 정본은 각 `tools/*.ts`의 `inputSchema`에 있다.

---

## HTTP API

| 메서드 | 경로 | 비고 |
|---|---|---|
| `GET` | `/health` | |
| `POST` | `/api/sessions/:sessionId/start` | |
| `GET` | `/projects/:projectId/knowledge` | 조회 — 비인증 |
| `PATCH` `DELETE` | `/projects/:projectId/knowledge/:id` | 쓰기 |
| `POST` | `/projects/:projectId/knowledge/:id/restore` | 소프트 삭제 복원 |
| `GET` | `/projects/:projectId/knowledge/:id/audit` | 변경 이력 |
| `POST` `GET` | `/workflows/:workflowId/oracles` | 생성·업서트 / 목록 |
| `PATCH` | `/oracles/:oracleId/approve` | |
| `PATCH` | `/workflows/:workflowId/risk-classification/approve` | |
| `GET` | `/projects/:projectId/decisions/pending` | **조건부 등록** — 아래 참고 |
| `POST` | `/projects/:projectId/decisions/:requestId/decision` | **조건부 등록** — 아래 참고 |
| `POST` | `/api/admin/dlq/redrive` | **인증 필수** — `authHook` 없으면 `server.ts`가 아예 등록하지 않는다 |

**표에 있다고 항상 떠 있는 것은 아니다.** 결정 라우트 2개는 `shouldWireDecisionRoute`가 `MANAGER_DECISION_ROUTING` + DB 풀 + `authHook` 셋을 모두 요구한다 — 기본값(플래그 off·JWT 미설정)에서는 등록되지 않는다. DLQ 재처리 라우트도 `authHook` 없으면 등록되지 않는다(무인증 admin 엔드포인트 금지).

쓰기 라우트는 `SERVICE_JWT_SECRET` 설정 시 서비스 JWT로 보호된다. **그 JWT는 서비스 토큰이지 사용자·조직 신원이 아니라서, 대상의 귀속을 확인하는 소유권 검사는 없다** — 공백의 범위와 근거는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)에 있다.

---

## 아키텍처

**파일 트리를 여기 복사하지 않는다.** 복사본은 반드시 어긋난다 — 디렉토리별 책임은 이 문서 위의 [src/ 책임 지도](#src-책임-지도)가 갖고, 각각의 **함정**은 [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md)에 있다.

경계를 넘는 계약만 별도 문서로 있다.

- 서비스 간 메시지 봉투·DLQ → [redis-envelope.md](../spec/redis-envelope.md)
- Manager ↔ 에이전트 RPC → [agent-rpc.md](../spec/agent-rpc.md)

---

## 환경 변수

**`packages/server/src/config.ts`의 Zod 스키마가 진실원천이다.** 키 이름·기본값·플래그 간 전제 체인이 전부 거기 있고, 전제는 각 키 위 주석에 적혀 있다. 목록을 여기 복사하지 않는다.

```bash
grep -n "전제" packages/server/src/config.ts   # 플래그 의존 체인
```

기동을 거부하는 조건과 자주 걸리는 함정은 [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md)의 환경 변수 절에 있다. 플래그가 실제로 무엇을 켜는지는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)가 판단 기준이다.

---

## 테넌트 태깅 — 격리가 아니다

10개 테이블 행에 `tenant_id` 를 **기록만** 한다. **읽기 술어가 0줄이라 테넌트 간 데이터는
분리되지 않는다.** 격리는 후속 슬라이스다. `upsert` 의미론을 쓰는 3개 테이블은 `COALESCE` 로
기존 태그를 보존한다.

**`oracles` 는 writer 둘 중 하나만 태깅된다.** 분해 경로(`upsertDraft`)는 `userContext.tenantId` 를
싣지만 사람이 `POST /oracles` 로 시드하는 `upsert` 는 INSERT 컬럼 목록에 `tenant_id` 가 없다 —
Manager 의 인증 훅은 서비스 토큰만 검증하고 사용자·org 클레임을 꺼내지 않아 **태그 소스 자체가
없다**. (DB 제약이 아니라 writer 의 성질이다 — 같은 `oracleId` 에 pending 상태로 `upsertDraft` 가 뒤따르면 `COALESCE` 가 채울 수는 있으나, **POST 는 클라이언트 지정 id 를, 초안은 해시 파생 id 를 쓰므로 기본적으로 충돌하지 않는다**.) 읽기 격리를 얹기 전에 이 경로의 태그 소스를 먼저 확보해야 한다. 그러지 않으면 오라클
조회가 조용히 null 을 반환해 conformance·impact·property 채널이 skip 된다.

## 환경 변수 · 기동 거부 조건

**`packages/server/src/config.ts`가 진실원천이다.** 64개 키의 이름·타입·기본값·전제 체인이 전부 거기 있고, 전제는 각 키 위 주석에 적혀 있다. 이 문서는 목록을 복사하지 않는다 — 복사본은 반드시 어긋난다.

읽는 법:

```bash
grep -n "전제" packages/server/src/config.ts   # 플래그 간 의존 체인
```

기동을 거부하는 조건은 전부 `configSchema`의 제약과 `superRefine`에서 나온다. 자주 걸리는 것:

- `ANTHROPIC_API_KEY`는 **모든 모드에서 필수**다. 없으면 parse 단계에서 기동 실패
- `SERVICE_JWT_SECRET`은 **설정했다면** 32자 이상이어야 한다 — `MODE=local`에서도 적용된다
- `MODE=remote`면 `SERVICE_JWT_SECRET`이 **있어야** 한다(무인증 mutation 개방 차단)
- `PAIS_PROFILE=autonomous`면 `SERVICE_JWT_SECRET`·`DATABASE_URL` 둘 다 필수. 미지 프로필은 throw
- 그 밖에도 스키마 제약을 어기면 기동을 거부한다(`MODE`가 `local|remote`가 아니거나 수치 필드가 범위를 벗어나는 경우 등). **이 목록은 대표 사례이지 전수가 아니다 — 전수는 `config.ts`가 갖는다**

`PAIS_PROFILE`은 parse 전에 검증된 플래그 묶음을 env에 병합하며, 이미 설정된 개별 env가 우선한다.

## 개발

```bash
cd xzawedManager && pnpm install && pnpm build   # turbo run build
cd packages/server && pnpm dev                   # tsx watch
cd packages/server && pnpm test <파일>
```

`xzawedShared`를 먼저 빌드해야 한다. 통합 테스트는 `TEST_DATABASE_URL` 또는 `DATABASE_URL`이 없으면 skip되므로 **skip 수를 항상 확인한다** — 로컬 그린이 CI 그린이 아니다.

---

## 관련

- [실행](../operations/running.md) — 로컬·Docker·원격 실행과 설정 계약
- [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md) — 책임 지도·계약·함정·실패 의미론
- [xzawedOrchestrator](orchestrator.md) · [xzawedPlanner](planner.md) · [xzawedDeveloper](developer.md) · [xzawedDesigner](designer.md)
