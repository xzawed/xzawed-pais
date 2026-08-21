# CLAUDE.md — xzawedManager

Claude tool-calling 루프와 하위 에이전트 디스패치를 담당하는 서비스(포트 3001). Turborepo(`packages/server`).

## 명령

```bash
pnpm install && pnpm build          # 루트에서 (turbo)
cd packages/server && pnpm dev      # tsx watch
cd packages/server && pnpm test <파일>
```

`*.integration.test.ts` 33개는 DB가 없으면 **skip된다**(`TEST_DATABASE_URL ?? DATABASE_URL` 기준, 31개). `REDIS_URL`까지 보는 것은 2개뿐이다. globalSetup이 경고를 한 번 찍지만 스위트는 초록으로 끝나므로, **로컬 그린을 CI 그린으로 착각하지 말 것** — `pnpm test` 출력의 skip 수를 항상 확인한다.

## src/ 책임 지도

| 경로 | 책임 |
|---|---|
| `claude/runner.ts` | tool-calling 루프. 승인 게이트·도메인 위키 주입·교차질의 라우팅·서킷브레이커가 여기 붙는다 |
| `tools/` | ToolHandler 레지스트리. `redis-agent-handler.ts`가 7개 에이전트 RPC를 담당 |
| `gates/approval-gate.ts` | 승인 게이트 순수 모듈(`effectiveMode`·`parseDecision`·`GATED_TOOLS`·`DEPLOY_TOOLS`) |
| `decompose/` | **분해 생산자.** `pipeline.ts`의 다단계 LLM 분해와 `map.ts`의 WorkPackage 매핑. 소비는 `streams/`가 한다 |
| `streams/` | Supervisor와 소비자들. 디스패치·lease·워커·검증·결정·리스크·릴리스·강등 |
| `db/` | 저장소 계층 + `migrations/001~017`. `oracle`·`decision`·`advisory`의 `*.types.ts`는 Zod 정본이지만 `release-gate.types.ts`는 TS 인터페이스, `risk-classification.types.ts`는 이벤트 상수다(아티팩트 스키마는 shared에 있다) |
| `api/` | `sessions`·`knowledge`·`decision`·`oracle`·`risk`·`admin`·`health` 라우트 |

## 계약

- **Redis**: `manager:to-{agent}:{sessionId}` 발신 → `{agent}:to-manager:{sessionId}` 수신. 소비자 그룹은 `{목적지}-consumers`. 봉투·재시도·DLQ·멱등 소비는 `@xzawed/agent-streams`의 `BaseConsumer`가 담당
- **에이전트 RPC**: `tools/`의 inputSchema와 7개 에이전트의 `src/types.ts`가 **같은 계약을 각자 재정의**한다. tsc가 이 경계를 교차검증하지 못하므로 한쪽만 고치면 런타임까지 조용하다. 변경 시 `/contract-drift-check`로 대조한다
- **HTTP**: Orchestrator ↔ Manager. `UserContext`(projectId·workspaceRoot·tenantId)가 요청에 실려 그래프까지 전파된다
- **DB 스키마**: `db/migrations/*.sql`이 정본. 문서에 복사하지 않는다

## 자율 아크

기본값은 **대화형 챗 + 사람 승인 게이트**다. 아래 서브시스템은 전부 플래그 뒤에 있고 기본 off다. 무엇이 켜져 있는지는 [`docs/LIVE_VS_FLAGGED.md`](../docs/LIVE_VS_FLAGGED.md)를 본다.

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

## fail-closed / fail-open

**어느 쪽인지 헷갈리면 여기를 본다. 반대로 알면 사고가 난다.**

| 지점 | 부재·오류 시 |
|---|---|
| 승인 게이트 파싱 실패·미지 응답 | **fail-closed** — 자동 승인 금지, `needs_human`으로 재요청. `MANAGER_GATE_FAILSAFE=false`가 레거시 fail-open 탈출구 |
| **승인 게이트 시점** | `deploy_project`는 **실행 전**(`requiresPreExecutionApproval`), 나머지 디스패치 도구는 **실행 후**(`requiresPostExecutionApproval`). 배포는 되돌릴 수 없는 외부 쓰기라 사후에 물으면 게이트가 아니라 통보다 — `revise`도 재실행하지 않고 피드백만 돌려준다(재실행 = 승인 없는 재푸시) |
| 검증 게이트 (증거 없음·판정 불가) | **fail-closed** — verdict 실패 시 `publishCompletion` 전에 반환 |
| 빈 테스트 스위트 | **fail-closed** — `success && failed===0`이어도 `passed<=0`이면 vacuous로 차단 |
| 릴리스 게이트 (증거 부재·skip) | **fail-closed** — `status:'blocked'` |
| 오라클 승인 tx 중 bad JSON | **fail-closed** — ROLLBACK |
| **배포 게이트 (게이트 부재·`'default'` sentinel·조회 오류)** | **fail-open — 허용한다.** `MANAGER_DEPLOY_GATE_STRICT`를 켜야 차단으로 바뀐다 |
| advisory 채널 | **비차단** — 구조적으로 verdict 경로에 유입되지 않는다 |
| 리스크·오라클·골든 미승인 | **skip** — 미승인 산출물은 라우팅도 게이트도 바꾸지 않는다 |

무음 통과·무음 소멸·무음 drop은 금지다. 처리할 수 없는 메시지는 조용히 ack하지 말고 error를 발행하거나 사람에게 올린다.

## 함정

- **`MANAGER_WP_MUTATION`만 켜면 영원히 skip된다.** mutation은 `wp.risk ≥ MANAGER_MUTATION_MIN_RISK`(기본 HIGH)일 때만 발화하는데, 분해가 만드는 WP의 `risk`는 스키마 기본값 **MEDIUM**이고 이를 올리는 유일한 생산 경로가 리스크 분류→사람 승인→`updateWpRisks` write-back이다. 체인이 없으면 항상 건너뛴다. **체인을 켜는 것은 필요조건이지 충분조건이 아니다** — 분류가 실제로 HIGH로 채점되고 승인까지 돼야 한다(write-back은 승인된 등급을 그대로 쓴다). `MANAGER_MUTATION_MIN_RISK`를 낮추는 쪽이 확실하다.
  기동 경고는 **`MUTATION + VERIFY + minRisk=HIGH + 체인 불완전`** 조합에서만 뜬다. VERIFY가 꺼져 있으면 다른 경고가 뜨고 채널은 애초에 검증 루프에 들어가지도 않는다.
- **lease 가시성은 자동 상향된다.** 활성 검증 채널이 요구하는 바닥값보다 설정값이 낮으면 기동 시 올린다(올리기만, 낮추지 않음). 채널을 여럿 켜면 WP당 에이전트 호출이 9단계까지 가므로 수동 상향은 불필요하지만 값이 바뀌었다는 로그는 확인한다.
- **Gherkin `then`은 thenable 함정**이다. 필드명이 `then`이면 Promise로 오인되어 await가 삼킨다 → `thenSteps`를 쓴다.
- **오라클 초안은 소비자 없이는 영속되지 않는다.** 초안 생성만 켜고 Supervisor(`TASK_MANAGER_ENABLED`+`DATABASE_URL`)를 끄면 emit은 되는데 저장이 안 된다.
- **`tsconfig.json`이 테스트 파일을 exclude한다.** 타입으로 호출부를 강제하는 장치는 `src/` 프로덕션 코드에만 성립하고 테스트 호출부는 검사되지 않는다.
- **userContext를 넘기는 trigger 테스트는 `ensureWs` mock을 반드시 주입**한다. 빠뜨리면 실제 `mkdir(workspaceRoot)`가 돌아 Linux CI에서 `EACCES`로 죽는다(로컬 Windows는 통과한다).
- **held-set은 in-memory다.** SAFE 모드에서 보류된 디스패치는 재시작 시 소실된다.
- **마이그레이션 러너에 버전 추적이 없다.** 매 기동마다 전량 재실행되므로 모든 마이그레이션이 멱등이어야 한다(`__tests__/migrate-idempotent.test.ts`가 정적으로 가드). Orchestrator는 `schema_migrations`로 1회만 적용하는 반대 모델이다.
- **트랜잭션 밖 `FOR UPDATE SKIP LOCKED`는 무효**다. 잠금이 즉시 풀려 동시성 보호가 사라진다.
- **소비자 그룹이 스트림을 공유하면 멱등 키에 그룹 성분을 넣어야 한다.** 없으면 한 그룹의 마커가 다른 그룹의 핸들러를 굶긴다.

## 테넌트 태깅 — 격리가 아니다

10개 테이블 행에 `tenant_id`를 **기록만** 한다. **읽기 술어가 0줄이므로 테넌트 간 데이터는 분리되지 않는다.** 격리는 후속 슬라이스다.

`upsert` 의미론을 쓰는 3개 테이블은 `COALESCE`로 기존 태그를 보존한다.

**`oracles`는 writer 둘 중 하나만 태깅된다.** 분해 경로(`upsertDraft`)는 `userContext.tenantId`를 싣지만, 사람이 `POST /oracles`로 시드하는 `upsert`는 INSERT 컬럼 목록에 `tenant_id`가 아예 없다 — Manager의 인증 훅은 서비스 토큰 `jwtVerify()`만 하고 사용자·org 클레임을 꺼내지 않으므로 태그 소스 자체가 없다. 따라서 그 경로로 들어온 행은 NULL로 남는다(DB 제약이 아니라 writer의 성질이다 — 같은 `oracleId`에 pending 상태로 `upsertDraft`가 뒤따르면 `COALESCE`가 채울 수는 있으나, POST는 클라이언트 지정 id를, 초안은 해시 파생 id를 쓰므로 기본적으로 충돌하지 않는다).

읽기 격리를 얹기 전에 이 경로의 태그 소스를 먼저 확보해야 한다. 그러지 않으면 오라클 조회가 조용히 null을 반환해 conformance·impact·property 채널이 skip된다.

## 환경 변수

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

## 참고

- 저장소 공통 규칙·보안 원칙·PR 워크플로 → [루트 CLAUDE.md](../CLAUDE.md)
- 무엇이 기본 실행되고 무엇이 플래그 뒤인지 → [`docs/LIVE_VS_FLAGGED.md`](../docs/LIVE_VS_FLAGGED.md)
