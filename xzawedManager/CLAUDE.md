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
| 릴리스 게이트 (증거 부재) | **fail-closed** — `status:'blocked'` |
| **릴리스 게이트 (채널 결과)** | `passed`·`not_applicable` 만 통과. **그 외는 전부 차단**(미지 종류 포함). `not_applicable`=설정상 비대상 또는 이 WP 가 대상 아님, `skipped`=대상인데 미증명 |
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
- **`MANAGER_WP_MUTATION`만 켜면 영원히 skip된다.** mutation은 `wp.risk ≥ MANAGER_MUTATION_MIN_RISK`(기본 HIGH)일 때만 발화하는데, 분해가 만드는 WP의 `risk`는 스키마 기본값 **MEDIUM**이고 이를 올리는 유일한 생산 경로가 리스크 분류→사람 승인→`updateWpRisks` write-back이다. 체인이 없으면 항상 건너뛴다. **체인을 켜는 것은 필요조건이지 충분조건이 아니다** — 분류가 실제로 HIGH로 채점되고 승인까지 돼야 한다. **그리고 이제 그 채점은 WP별이다**(S5.3b) — 프로젝트가 HIGH여도 그 위험이 지목되지 않은 WP는 HIGH가 되지 않는다. `MANAGER_MUTATION_MIN_RISK`를 낮추는 쪽이 확실하다.
- **mutation 손잡이는 둘이고 같은 것을 말하지 않는다(S5.4).** `MANAGER_MUTATION_MIN_RISK`는 **돌릴지**를, `MANAGER_MUTATION_THETA*`는 **얼마나 엄하게**를 정한다. per-tier θ(`_LOW`·`_MEDIUM`·`_HIGH`)는 **기본값이 없다** — 미설정이면 공통 `MANAGER_MUTATION_THETA`(0.6)를 그대로 받아 동작이 변하지 않는다. 운영 데이터 없이 등급별 숫자를 기본값으로 출하하는 것이 곧 근거 없는 캘리브레이션이라 손잡이만 준다. **설정한 θ가 닿지 않는 조합이 둘 있고 기동 경고가 표면화한다**: min-risk가 그 등급을 아예 거를 때, 그리고 risk 체인이 꺼져 전 WP가 MEDIUM에 머물 때(후자는 min-risk=HIGH만 보는 기존 G7 경고가 놓친다)
- **θ 키를 바꿀 때 tsc를 믿지 마라(S5.4 실측).** `VerifyDeps`의 `mutationTheta`를 지우고 `mutationThetaByRisk`로 바꿨는데 `tsc --noEmit`이 **아무 오류도 내지 않았다** — `server`→`supervisor`→`worker` 릴레이가 `...(x !== undefined && { x })` 조건부 spread라 초과 속성 검사가 적용되지 않는다. 배선 3곳이 옛 이름을 넘긴 채 per-tier θ가 도달조차 못 했고, 유닛 테스트도 "mutation이 돌았는가"만 봐서 못 잡았다. 지금은 `worker.test.ts`가 하니스 plan에 박힌 θ 값으로 릴레이를 봉인한다
- **`wp.risk`는 프로젝트 등급의 사본이 아니다(S5.3b).** 분류 아티팩트의 `risk`는 **프로젝트 종합**(모델 라우팅·사람 게이트 입력)이고 `wpRisks`가 **WP 판정**이다. write-back은 후자만 쓴다. **판정이 없으면 아무것도 쓰지 않는다** — 종합 등급을 전 WP에 찍는 것이 결함 F2였고, 그러면 `wp.risk`를 읽는 mutation θ_risk 게이트와 DEGRADED 서명 게이트가 판단하는 척만 한다. 한 WP에 걸리는 claim은 **전 WP 공통(`wpIds` 빈 것) + 그 WP를 지목한 것**이라, 분류기가 아무 판단도 못 하면 WP 등급 = 프로젝트 등급이고 **낮아지는 유일한 길은 분류기가 그 claim을 다른 WP로 좁힌 것**이다(증거가 적어서 안전해지는 역설 없음). LLM이 없는 id를 지어내면 지목을 버리고 전 WP 공통으로 **넓힌다** — 좁히는 쪽으로 잘못 가면 게이트가 풀린다
  기동 경고는 **`MUTATION + VERIFY + minRisk=HIGH + 체인 불완전`** 조합에서만 뜬다. VERIFY가 꺼져 있으면 다른 경고가 뜨고 채널은 애초에 검증 루프에 들어가지도 않는다.
- **lease 가시성은 자동 상향된다.** 활성 검증 채널이 요구하는 바닥값보다 설정값이 낮으면 기동 시 올린다(올리기만, 낮추지 않음). 채널을 여럿 켜면 WP당 에이전트 호출이 9단계까지 가므로 수동 상향은 불필요하지만 값이 바뀌었다는 로그는 확인한다.
- **Gherkin `then`은 thenable 함정**이다. 필드명이 `then`이면 Promise로 오인되어 await가 삼킨다 → `thenSteps`를 쓴다.
- **오라클 초안은 소비자 없이는 영속되지 않는다.** 초안 생성만 켜고 Supervisor(`TASK_MANAGER_ENABLED`+`DATABASE_URL`)를 끄면 emit은 되는데 저장이 안 된다.
- **`tsconfig.json`이 테스트 파일을 exclude한다.** 타입으로 호출부를 강제하는 장치는 `src/` 프로덕션 코드에만 성립하고 테스트 호출부는 검사되지 않는다.
- **userContext를 넘기는 trigger 테스트는 `ensureWs` mock을 반드시 주입**한다. 빠뜨리면 실제 `mkdir(workspaceRoot)`가 돌아 Linux CI에서 `EACCES`로 죽는다(로컬 Windows는 통과한다).
- **꺼진 채널도 결과를 기록한다 — 그 값이 게이트를 살리고 죽인다.** 검증 채널 5종은 전부 기본 off인데 `runChannelChecks`가 그때도 `recordOutcome`을 부른다. 그 값이 `skipped`(미증명)면 릴리스 게이트를 켜는 순간 **테스트를 통과한 WP조차 "미증명 채널 5개"로 영구 차단**된다. 그래서 비대상은 `not_applicable`로 기록한다. 이 결함은 **유닛 1466건 초록 아래 숨어 있었다** — 게이트 테스트가 outcome을 손으로 만들어 넣을 뿐 `verify.ts`가 실제로 무엇을 기록하는지 본 테스트가 0개였기 때문이다. 새 채널을 추가하면 **비대상 분기의 기록값을 반드시 확인**한다
- **경계선: 켠 채널이 증명 못 한 것은 비대상이 아니다.** 판단 기준은 **누가 범위를 정했는가**다 — 설정·설계가 정한 범위 밖(플래그 off·min-risk 미달)이면 `not_applicable`, 범위 안인데 재료가 없으면(승인 베이스라인 부재·스토어 미주입) `skipped`다. 운영자가 증명을 요구했는데 증명 없이 통과시키는 것이 **정확히 이 게이트가 막으려는 것**이다. 위 항목을 고치면서 한 번 반대로 넣었다가 Grok 반증이 잡았다
- **분해 입력(`intent`)은 `graph_dag`에 함께 영속된다.** `userContext`와 같은 방식의 additive JSONB 필드다(마이그레이션 0). 이것이 없으면 `spec_fix`(재분해)가 돌릴 재료 자체가 없다 — `produceDecomposition(intent,…)`인데 intent 는 요청과 함께 사라졌었다. **`upsertGraph`는 graph_dag를 통째로 교체하므로** 재분해 발행이 intent를 안 실으면 유실된다 — 소비자가 병합 때문에 이미 읽은 기존 그래프에서 이월한다
- **핸들러 없는 choice 버튼은 그리지 않는다.** `buildDefectBrief`의 `options`는 결정 소비자가 **실제로 처리하는** choice만 나열한다 — 없는 것을 노출하면 눌러도 RESOLVED만 남는 거짓 affordance다. `spec_fix`는 핸들러가 배선된 경우에만(`specFixAvailable`) 노출되고, `accept_known`·`reject`는 여전히 빠져 있다
- **WP I/O 는 분해가 예측한 것이 아니라 실행이 실제로 낸 것이다.** 성공한 WP 의 결과 `artifacts`가 `wp_outputs`에 기록되고, 후행 WP 디스패치 시 `wp.dependencies`의 산출물 합집합이 에이전트 입력의 `artifacts`가 된다. **`graph_dag`의 `inputs`/`outputs` 필드는 채우지 않는다** — 그것은 계획이고 이것은 사실이라, 한 자리에 쓰면 `wp.status`가 영원히 `DRAFTED`인 채 실제 상태는 `wp_state_log`에만 있는 것과 같은 혼동이 생긴다. 이 배선 전에는 `buildWorkerInput`이 `artifacts: []`를 하드코딩해 **security static이 구조적으로 항상 `requested: 0`**이었다
- **DLQ·PEL 은 고정 키 목록으로 못 잰다 — `GET /metrics`가 `SCAN`으로 훑는다.** 스트림이 per-session·per-workflow라 DLQ 키 `{stream}:dlq`도 같이 늘어난다. 알려진 키 하나만 재면 나머지가 쌓여 있어도 **0을 보고**한다. `KEYS`는 단일 스레드 Redis를 블로킹하므로 쓰지 않는다. **전부 보지 못하면 `..._truncated`로 합계가 하한임을 드러낸다** — 키 상한·SCAN 왕복 상한·스트림별 실패 셋 다 같은 플래그를 쓴다(소비자에게 중요한 건 왜가 아니라 하한이라는 사실이고, 실패 수는 `..._stream_errors`가 따로 준다). 잘라내고 전량인 척하는 것이 관측의 최악이다. **SCAN 은 같은 키를 두 번 줄 수 있고**(Set 으로 dedup), **`TYPE stream`은 SCAN 시점만 보장한다**(그 뒤 타입이 바뀌면 `XLEN`이 WRONGTYPE — 스트림별로 감싸지 않으면 키 하나가 전체 지표를 날리고 `pais_redis_up 0`이라는 거짓을 낸다). 전 서비스가 한 Redis를 공유하므로 Manager 한 곳에서 시스템 전체가 보인다(서비스별 배선 복제 없음). **`/metrics`는 헬스체크가 아니다** — Redis가 죽어도 200을 주고 그 사실을 `pais_redis_up 0`으로 노출한다
- **`manager:events:{workflowId}`는 소비자가 0이고, per-workflow라 고정 이름 소비자가 붙지도 못한다.** `wp.verification.failed`·`decomposition.inconsistent`가 여기로 간다 — 발행하면 관측된 것처럼 보이지만 **아무도 읽지 않는다**. 검증 실패 사유는 그래서 `wp_verification_failures`에 별도로 영속하고 에스컬레이션 브리프(`makeEscalationBrief`)가 읽어 대기함까지 나른다. **이 스트림에 새 이벤트를 얹을 때는 "누가 읽는가"를 먼저 답한다**
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
- **readiness 의 Redis ping 은 전용 연결을 써야 한다(S4.3 실측).** 공유 클라이언트는 `StreamConsumer` 가 `XREADGROUP ... BLOCK 2000` 으로 점유하는데, ioredis 는 한 연결에서 명령을 **직렬화**하므로 그 위의 `ping()` 은 블록이 풀릴 때까지 큐에 선다 — readiness 예산 1000ms 보다 블록 2000ms 가 길어 **항상** 초과한다. 증상은 조용하고 치명적이다: 세션이 없을 때는 200 이다가 **첫 세션이 생기는 순간 영구 503**(실측 — 재시작 직후 6/6 → 세션 1개 후 0/6 → 전용 연결로 고친 뒤 10/10). compose healthcheck 는 30초×3 이라 **첫 대화 ~90초 뒤** 컨테이너가 unhealthy 로 뒤집히고 Launcher 는 그걸로 `running` 을 판정한다 — 정상 동작 중인 스택이 사용자에게 "죽었다"고 보고된다. `getProbeRedisClient` 가 그 전용 연결이고, **readiness 가 물어야 하는 것은 "Redis 가 닿는가"이지 "공유 연결이 지금 한가한가"가 아니다** — 소비 루프 생존은 `loopProbe` 가 따로 본다
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
