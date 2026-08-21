# xzawedManager

Orchestrator의 지시를 받아 Claude tool-calling 루프로 전문 에이전트에 위임하는 서비스.

**포트:** 3001

---

## 개요

`orchestrator:to-manager:{sessionId}`에서 `task_request`를 받으면 tool-calling 루프를 시작한다. Claude가 도구를 고르면 해당 ToolHandler가 대상 에이전트 스트림에 요청을 발행하고 응답을 기다리며, 도구 실행 전후로 `status_update`를 Orchestrator에 보낸다.

루프 상한은 `MANAGER_MAX_ITERATIONS`이고 **기본 50**이다(`claude/runner.ts` `parseMaxIterations`). 상수가 아니라 env로 조정된다.

대화형 루프 밖의 자율 아크(Task Graph·분해·검증 채널·의사결정·리스크·릴리스)는 **전부 플래그 뒤에 있고 기본 off**다. 무엇이 켜져 있고 무엇이 휴면인지는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)가 단일 진실원천이다 — 여기 복제하지 않는다. 서브시스템별 책임과 함정은 [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md)에 있다.

---

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

**파일 트리를 여기 복사하지 않는다.** 복사본은 반드시 어긋난다. 디렉토리별 책임은 [xzawedManager/CLAUDE.md](../../xzawedManager/CLAUDE.md)의 `src/ 책임 지도`가 갖는다.

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
