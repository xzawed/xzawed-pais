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
| `db/` | 저장소 계층 + `migrations/`. `oracle`·`decision`·`advisory`의 `*.types.ts`는 Zod 정본이지만 `release-gate.types.ts`는 TS 인터페이스, `risk-classification.types.ts`는 이벤트 상수다(아티팩트 스키마는 shared에 있다) |
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
| **승인 게이트 시점** | 되돌릴 수 없는 외부 쓰기는 **실행 전**(`requiresPreExecutionApproval`), 에이전트 디스패치 산출물은 **실행 후**(`requiresPostExecutionApproval`). 사후에 물으면 게이트가 아니라 통보다 — `revise`도 재실행하지 않고 피드백만 돌려준다(재실행 = 승인 없는 재푸시) |
| **사전 게이트 대상** | `deploy_project` 전체 + `github_ops`의 **쓰기 액션만**(`GITHUB_WRITE_ACTIONS` — createRepo·createBranch·commitAndPush·createPR·createIssue·mergeBranch). 도구가 아니라 액션 단위다 — 목록 조회까지 카드를 띄우면 게이트가 소음이 되고, 소음이 된 게이트는 무조건 승인을 부른다 |
| 검증 게이트 (증거 없음·판정 불가) | **fail-closed** — verdict 실패 시 `publishCompletion` 전에 반환 |
| 빈 테스트 스위트 | **fail-closed** — `success && failed===0`이어도 `passed<=0`이면 vacuous로 차단 |
| 릴리스 게이트 (증거 부재·skip) | **fail-closed** — `status:'blocked'` |
| 오라클 승인 tx 중 bad JSON | **fail-closed** — ROLLBACK |
| **배포 게이트 (게이트 부재·`'default'` sentinel·조회 오류)** | **fail-open — 허용한다.** `MANAGER_DEPLOY_GATE_STRICT`를 켜야 차단으로 바뀐다. **기본값을 지금 뒤집지 않는다** — 아래 근거 |
| advisory 채널 | **비차단** — 구조적으로 verdict 경로에 유입되지 않는다 |
| 리스크·오라클·골든 미승인 | **skip** — 미승인 산출물은 라우팅도 게이트도 바꾸지 않는다 |

무음 통과·무음 소멸·무음 drop은 금지다. 처리할 수 없는 메시지는 조용히 ack하지 말고 error를 발행하거나 사람에게 올린다.

**`MANAGER_DEPLOY_GATE_STRICT` 기본값을 지금 뒤집지 않는 이유.** 둘이다.

1. **기본 태세에서 무의미하다.** `MANAGER_DEPLOY_GATE` 자체가 기본 off라 게이트가 돌지 않는다. STRICT는 그 위에 얹히는 값이다.
2. **fail-open이 무방비가 아니다.** `deploy_project`는 `DEPLOY_TOOLS`라 **실행 전 사람 승인**이 강제되고 `effectiveMode`가 auto override를 무시한다. 게이트 판정이 없어도 사람이 카드를 보고 승인해야 배포가 나간다.

**셋째 이유였던 "지금 켜면 배포가 영구 차단된다"는 사라졌다.** `design_ui`·`security_audit` WP가 자기검증으로 각각 `design`·`security` 증거를 남기고(`streams/verify.ts`), 게이트의 요구 채널이 `owningRole`에서 파생된다(`streams/release-gate.ts`). **역할을 요구 맵에 넣기 전에 그 역할이 증거를 남기는지 먼저 확인한다** — 순서를 뒤집으면 그 워크플로가 영구 blocked(증거 없음)이거나 무음 통과(요구 없음)가 된다.

**뒤집는 조건.** 남은 선행은 **per-WP 재채점(S5.3)** 이고, 릴리스 게이트 하드 닫기와 **같은 시점**에 함께 판단한다. 상세는 [완성 실행계획](../docs/superpowers/specs/2026-08-22-completion-plan-autonomous-factory.md).

## 함정

- **종료 순서는 인테이크 차단 → HTTP 드레인 → registry·DB 풀 → Redis 다.** 이전엔 `closeAll()`이 DB 풀까지 닫은 **뒤** `app.close()`를 불러, 진행 중이던 요청이 이미 `end()`된 pg 풀을 만났다. 창의 길이는 '잠깐'이 아니라 종료 시점 최장 in-flight 쿼리 시간 전체다 — `pg-pool.end()`는 체크아웃된 클라이언트가 전부 반납될 때까지 resolve 하지 않는다. `buildServer`가 `stopIntake`·`closeResources`를 따로 반환하고 그 사이에 드레인이 들어간다(`closeAll`은 기존 호환용 조합자로 남는다)
- **종료 코어는 Orchestrator 와 복제 블록이다.** 서비스 간 import 금지(M3)에 Orchestrator 는 `@xzawed/agent-streams`도 의존하지 않아 공유 경로가 없다. `replicated-block: shutdown-core` 마커가 붙어 있고 동일성은 `scripts/check-replicated-blocks.js`가 강제한다 — 한쪽만 고치면 두 서비스의 종료 의미론이 갈라진다
- **Fastify 인스턴스 옵션은 `makeServerOptions`가 단일 지점이다.** `buildServer`가 DB·Redis·Anthropic 배선을 통째로 끌고 와 저장소에 그것을 부르는 테스트가 **하나도 없다** — 그래서 인스턴스 옵션 두 줄이 오래 틀린 채로 있었다(로거가 `MODE==='local'`이라 **프로덕션에서만 꺼져** `app.log.*` 호출부 65곳이 no-op 이었고, `trustProxy`는 `true` 하드코딩이었다). 옵션을 순수 함수로 떼어 `__tests__/server-options.test.ts`가 고정한다. 옵션을 추가할 때 `Fastify({...})`에 직접 쓰지 말고 그 함수에 넣는다
- **`MANAGER_WP_MUTATION`만 켜면 영원히 skip된다.** mutation은 `wp.risk ≥ MANAGER_MUTATION_MIN_RISK`(기본 HIGH)일 때만 발화하는데, 분해가 만드는 WP의 `risk`는 스키마 기본값 **MEDIUM**이고 이를 올리는 유일한 생산 경로가 리스크 분류→사람 승인→`updateWpRisks` write-back이다. 체인이 없으면 항상 건너뛴다. **체인을 켜는 것은 필요조건이지 충분조건이 아니다** — 분류가 실제로 HIGH로 채점되고 승인까지 돼야 한다(write-back은 승인된 등급을 그대로 쓴다). `MANAGER_MUTATION_MIN_RISK`를 낮추는 쪽이 확실하다.
  기동 경고는 **`MUTATION + VERIFY + minRisk=HIGH + 체인 불완전`** 조합에서만 뜬다. VERIFY가 꺼져 있으면 다른 경고가 뜨고 채널은 애초에 검증 루프에 들어가지도 않는다.
- **lease 가시성은 자동 상향된다.** 활성 검증 채널이 요구하는 바닥값보다 설정값이 낮으면 기동 시 올린다(올리기만, 낮추지 않음). 채널을 여럿 켜면 WP당 에이전트 호출이 9단계까지 가므로 수동 상향은 불필요하지만 값이 바뀌었다는 로그는 확인한다.
- **Gherkin `then`은 thenable 함정**이다. 필드명이 `then`이면 Promise로 오인되어 await가 삼킨다 → `thenSteps`를 쓴다.
- **오라클 초안은 소비자 없이는 영속되지 않는다.** 초안 생성만 켜고 Supervisor(`TASK_MANAGER_ENABLED`+`DATABASE_URL`)를 끄면 emit은 되는데 저장이 안 된다.
- **`tsconfig.json`이 테스트 파일을 exclude한다.** 타입으로 호출부를 강제하는 장치는 `src/` 프로덕션 코드에만 성립하고 테스트 호출부는 검사되지 않는다.
- **userContext를 넘기는 trigger 테스트는 `ensureWs` mock을 반드시 주입**한다. 빠뜨리면 실제 `mkdir(workspaceRoot)`가 돌아 Linux CI에서 `EACCES`로 죽는다(로컬 Windows는 통과한다).
- **held-set은 in-memory다.** SAFE 모드에서 보류된 디스패치는 재시작 시 소실된다.
- **마이그레이션은 `manager_schema_migrations`로 1회만 적용된다**(S3.4 이전엔 추적이 없어 매 기동 전량 재실행이었다). **이름의 `manager_` 접두사가 계약이다** — 런타임에 Orchestrator와 같은 DB를 쓰는데(`docker-compose.yml:83`) Orchestrator가 이미 `schema_migrations`에 자기 버전 1~8을 기록한다. 접두사를 떼면 두 서비스의 버전 번호가 서로를 덮어 **예외 없이 조용히 마이그레이션을 건너뛴다**(Manager가 자기 001~008을 적용됨으로 오인하거나, 반대로 Orchestrator가 `users`·`sessions` 없이 성공을 반환한다). 다른 테이블이 전부 `manager_` 접두사인 것과 같은 이유다
- **버전 추적이 생겨도 멱등 가드는 남는다.** 추적 테이블이 없던 기존 DB가 새 러너로 처음 뜨면 기록이 비어 전량이 한 번 더 돈다 — 그 한 번을 안전하게 만드는 것이 `db/migration-guard.ts`이고 `__tests__/migrate-idempotent.test.ts`가 실제 파일을 훑는다. **`ADD CONSTRAINT`와 이름 없는 제약(`ADD PRIMARY KEY`·`ADD UNIQUE`·`ADD FOREIGN KEY`·`ADD CHECK`), `CREATE TYPE`은 Postgres에 `IF NOT EXISTS` 문법이 없어** 카탈로그 조회 가드(`pg_constraint`·`pg_type`)나 `DO $$ ... EXCEPTION WHEN duplicate_object $$`로 감싸야 통과한다. 가드 판정은 **블록이 아니라 IF 영역 단위**다
- **WP 상태 정본은 `@xzawed/agent-streams` 의 `types/wp-state.ts` 하나다**(S6.1). 여기 값을 다시 선언하지 않는다 — 이전엔 shared 소문자 enum 과 Manager 대문자 상수가 **교집합 0** 으로 갈려 있었고, 한쪽을 읽는 술어가 다른 쪽이 쓴 값을 영원히 못 봤다(`isReady` 의 `wp.status === 'done'` 기본 술어가 그랬다). `dispatch-constants.ts` 의 별칭은 `satisfies WpStatus` 로 드리프트를 tsc 에 노출한다.
- **`wp_state_log` writer 는 둘이고 둘 다 `assertWpTransition` 을 지난다**(`dispatch.repo.appendWpEvent` · `task-graph.repo.appendTransition`). **DB CHECK 와 이 가드는 다른 것을 막는다** — CHECK 는 값 집합만 보므로 `DONE → DISPATCHED` 처럼 값이 전부 유효한 불법 전이는 잡지 못한다. 새 writer 를 추가하면 가드를 함께 건다.
- **재분해는 진행 중 WP를 보존한다**(S6.2). 술어는 `wp.status`가 **아니라** `latestStates`(`wp_state_log`)에서 온다 — `graph_dag`의 status는 프로덕션에서 영원히 `DRAFTED`이고(`decompose/map.ts`가 유일한 writer) 아무도 바꾸지 않으므로, `mergeKeepInflight`의 기본 술어로 판정하면 **항상 공집합**이라 병합이 무의미해진다. 그 위에 세운 유닛 테스트는 위음성이라 **pg 통합이 필수**다. 병합 결과는 다시 `detectCycle`한다 — 각각 비순환이어도 합집합은 순환일 수 있다
- **`graph_dag`를 쓰는 곳은 둘이고 둘 다 원자적이어야 한다.** `upsertGraph`(재분해)와 `updateWpRisks`(리스크 write-back). 후자는 원래 `getGraph`→JS 재조립→전체 교체라, 읽기와 쓰기 사이에 재분해가 끼면 그 결과를 통째로 되돌렸다(lost update). 단일 `UPDATE`+`jsonb_set`으로 창 자체를 없앴다 — **새 writer를 추가할 때 read-modify-write를 하지 않는다**
- **트랜잭션 밖 `FOR UPDATE SKIP LOCKED`는 무효**다. 잠금이 즉시 풀려 동시성 보호가 사라진다.
- **소비자 그룹이 스트림을 공유하면 멱등 키에 그룹 성분을 넣어야 한다.** 없으면 한 그룹의 마커가 다른 그룹의 핸들러를 굶긴다.
- **세션 정리는 게이트웨이 경로에서만 의미가 있다.** `makeSessionStarter`를 부르는 곳이 둘인데 프로덕션 진입은 `server.ts`의 게이트웨이 starter 하나뿐이다. `sessions.route.ts`가 만드는 starter는 `POST /api/sessions/:sessionId/start` 전용이고 그 엔드포인트를 호출하는 코드가 저장소에 없다 — 테스트에서만 도달한다. 그래서 starter의 `registry`는 **필수이되 nullable**이다(선택으로 두면 누락이 무음 no-op이 되어 tsc가 못 잡는다).
- **세션 종료는 에이전트에 통지해야 한다.** `registry.releaseAll` → `RedisAgentHandler.releaseSession` → 게이트웨이 `event:'end'`가 에이전트 쪽 세션 소비자와 그 전용 Redis 연결을 회수시키는 유일한 경로다. 이 체인 중 하나라도 끊기면 에이전트에 소비자가 무한 누적되고 1000개에서 신규 세션이 폐기된다.
- **RPC 타임아웃은 `_notifiedSessions` memo를 푼다.** 에이전트만 재시작되면 그 소비자는 사라졌는데 Manager는 "이미 통지했다"고 기억한다. 타임아웃이 유일한 감지 신호라 거기서 memo를 풀어 다음 호출이 재통지하게 한다.

## 헬스체크

`/health` 는 liveness(정적 200), `/health/ready` 는 readiness다. compose healthcheck 는 후자를 친다.

- **프로브 재료는 값이 아니라 접근자로 넘긴다.** `healthRoute` 등록이 `sessionGateway` 생성보다 **앞**이라 값을 직접 주면 그 시점에 아직 없다. 접근자는 요청 시점에 평가되므로 등록 순서 문제가 사라진다
- **`HealthDeps` 필드는 전부 선택이다.** 주지 않은 것은 검사 대상이 아니고, 하나도 주지 않으면 항상 ready 다(기존 호출부 호환). DB 프로브는 `pool()` 이 null 이면 `not_configured` — prod compose 가 `DATABASE_URL` 을 주지 않으므로 이것을 실패로 세면 배포가 영구 unhealthy 다
- **판정 코어는 `@xzawed/agent-streams` 의 `health/readiness.ts`** 다. Orchestrator 는 그 라이브러리를 의존하지 않아 복제본을 쓴다(`replicated-block: readiness-core`)

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
