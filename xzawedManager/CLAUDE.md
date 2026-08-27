# CLAUDE.md — xzawedManager

Claude tool-calling 루프와 하위 에이전트 디스패치를 담당하는 서비스(포트 3001). Turborepo(`packages/server`).

## 명령

```bash
pnpm install && pnpm build          # 루트에서 (turbo)
cd packages/server && pnpm dev      # tsx watch
cd packages/server && pnpm test <파일>
```

`*.integration.test.ts` 39개는 인프라가 없으면 **skip된다** — pg 게이트(`TEST_DATABASE_URL ?? DATABASE_URL`)가 36개, `REDIS_URL`까지 보는 것이 3개다. globalSetup이 경고를 한 번 찍지만 스위트는 초록으로 끝나므로, **로컬 그린을 CI 그린으로 착각하지 말 것** — `pnpm test` 출력의 skip 수를 항상 확인한다.

**CI에서는 `REQUIRE_INTEGRATION`이 게이트를 fail-closed로 만든다 — 값이 게이트 이름이다.** `1`은 전 게이트, `pg`·`redis`·`pg,redis`는 그것만 요구하고, 요구한 게이트가 닫혀 있으면 globalSetup이 **throw해서 런을 죽인다**(모르는 이름도 오타로 보고 throw — 오타가 "요구 없음"으로 떨어지면 이 장치 자체가 위장 초록이다). 이름 지정이 필요했던 이유가 실측이다: pg 파일 36개가 도는 곳은 `turborepo` 잡인데 **거기엔 Redis가 없어 `=1`을 붙이면 항상 throw**했고, 그래서 붙이지 못한 채 **통합 커버리지의 대부분이 fail-closed 보호 밖**에 있었다. 지금은 `turborepo`가 `=pg`, `manager-redis-integration`이 `=1`이다.

## 구조

`src/` 디렉토리별 책임 → [docs/services/manager.md](../docs/services/manager.md#src-책임-지도).
**계약·함정만 이 파일에 둔다** — 지도는 매 세션 컨텍스트에 실릴 필요가 없다.
## 계약

- **Redis**: `manager:to-{agent}:{sessionId}` 발신 → `{agent}:to-manager:{sessionId}` 수신. 소비자 그룹은 `{목적지}-consumers`. 봉투·재시도·DLQ·멱등 소비는 `@xzawed/agent-streams`의 `BaseConsumer`가 담당
- **에이전트 RPC**: `tools/`의 inputSchema와 7개 에이전트의 `src/types.ts`가 **같은 계약을 각자 재정의**한다. tsc가 이 경계를 교차검증하지 못하므로 한쪽만 고치면 런타임까지 조용하다. 변경 시 `/contract-drift-check`로 대조한다
- **HTTP**: Orchestrator ↔ Manager. `UserContext`(projectId·workspaceRoot·tenantId)가 요청에 실려 그래프까지 전파된다
- **DB 스키마**: `db/migrations/*.sql`이 정본. 문서에 복사하지 않는다

## 자율 아크

기본값은 **대화형 챗 + 사람 승인 게이트**다. 자율 서브시스템은 전부 플래그 뒤에 있고 기본 off다.

- 서브시스템 → 코드 위치 **지도** → [docs/services/manager.md](../docs/services/manager.md#자율-아크-서브시스템-지도)
- 무엇이 켜져 있고 무엇이 휴면인지 → [docs/LIVE_VS_FLAGGED.md](../docs/LIVE_VS_FLAGGED.md)
- 각 서브시스템의 **함정**은 아래 「함정」 절에 있다

검증 게이트의 다섯 채널(파생·conformance·impact·property·security)은 전부 **hard-AND**다. 하나라도
실패하면 완료를 발행하지 않고 lease 백스톱이 회수한다. 판정 기준은 `streams/verify.ts` 의
`judgePrimaryResult` 가 단일 지점이다.
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
| **배포 게이트 (게이트 부재·`'default'` sentinel·조회 오류)** | **fail-closed — 차단한다**(`MANAGER_DEPLOY_GATE_STRICT` 기본 true). 되돌리려면 `=false`. 단 게이트 자체가 기본 off라 기본 태세에서는 이 값이 어떤 경로에도 닿지 않는다 — 아래 근거 |
| advisory 채널 | **비차단** — 구조적으로 verdict 경로에 유입되지 않는다. 다만 **통과한 verdict 뒤에만 생산**된다(아래) |
| 리스크·오라클·골든 미승인 | **skip** — 미승인 산출물은 라우팅도 게이트도 바꾸지 않는다 |

무음 통과·무음 소멸·무음 drop은 금지다. 처리할 수 없는 메시지는 조용히 ack하지 말고 error를 발행하거나 사람에게 올린다.

**`MANAGER_DEPLOY_GATE_STRICT` 기본값은 true 다(fail-closed).** 게이트 자체가 기본 off 라
**기본 태세에서는 이 값이 어떤 경로에도 닿지 않는다** — `MANAGER_DEPLOY_GATE`가 꺼져 있으면
게이트 객체가 생성되지 않는다. 그 셋(deploy·release·pool)을 켠 운영자는 "게이트를 통과하지
않으면 배포하지 마라"를 명시적으로 요구한 것이고, 그 상태에서 "게이트가 안 돌았다"를 통과로
처리하면 요구한 증명 없이 배포가 나간다. **미증명은 통과가 아니다.**

**`ReleaseDeployGate` 생성자의 `strict`는 필수 인자다.** 기본값을 두면 config 기본값(true)과 생성자 기본값이 서로 다른 태세를 말하고, 인자를 빠뜨린 호출자가 조용히 fail-open을 얻는다. 다만 **tsc가 강제하는 범위는 `src/`까지다** — `tsconfig`가 `**/*.test.ts`를 제외하므로 테스트는 손으로 명시한다.

## 함정

- **종료 순서는 인테이크 차단 → HTTP 드레인 → registry·DB 풀 → Redis 다.** 이전엔 `closeAll()` 이 DB 풀까지 닫은 **뒤** `app.close()` 를 불러, 진행 중이던 요청이 이미 `end()` 된 pg 풀을 만났다. 창의 길이는 종료 시점 최장 in-flight 쿼리 시간 전체다(`pg-pool.end()` 는 체크아웃된 클라이언트가 전부 반납될 때까지 resolve 하지 않는다). `buildServer` 가 `stopIntake`·`closeResources` 를 따로 반환하고 그 사이에 드레인이 들어간다(**`closeAll` 은 기존 호환용 조합자로 남는다** — 지우지 않는다)
- **종료 코어·에러 봉투·readiness·프로필 병합은 Orchestrator 와 복제 블록이다.** 서비스 간 import 금지(M3)에 Orchestrator 는 shared 도 의존하지 않아 공유 경로가 없다. 동일성은 `scripts/check-replicated-blocks.js` 가 강제한다(6종) — 한쪽만 고치면 파일:줄로 지목하고 실패한다
- **`buildServer`는 테스트에서 부를 수 있다.** DB·Redis·Anthropic 셋 다 지연 연결이라 `DATABASE_URL` 없이 죽은 Redis 포트로도 기동한다 — `__tests__/server-wiring.test.ts`(라우트 트리 단언)와 `test/server-wiring.integration.test.ts`(pool 필요한 배선)가 그것을 쓴다. **"부르지 못한다"는 오래 적혀 있던 거짓이었고**, 그 전제 때문에 배선 판정이 아무도 안 보는 자리에서 자랐다(한때 라인 1/236 · 분기 0/396)
- **판정은 순수 함수로 떼고 `server.ts`는 결과만 소비한다.** 지금 그렇게 된 것 넷 — `makeServerOptions` · `startupWarnings`(`startup-warnings.ts`) · `releaseGateWarnings` · `shouldWireSupervisor`/`shouldWireDecisionRoute`. **경고 조건이나 옵션을 `buildServer` 안에 직접 쓰지 않는다**
- **advisory 는 통과한 verdict 를 전제한다.** 실패한 verdict 는 호출부 `if (gate) return gate` 가 막고, 남는 구멍인 "검증이 꺼져 판정 자체가 없는" 경우는 `maybeProduceAdvisory` 가드의 `verifyEnabled === true` 가 닫는다. **이 문구는 과거에 코드와 반대였다** — 고칠 때는 `worker.advisory.test.ts`(동작)와 `startup-warnings.test.ts`(문구) **양쪽**을 본다
- **`maybeRequestGoldenSignoff`는 같은 구조지만 전제가 다르다.** 바로 다음 줄에서 불리고 그 가드에도 `verifyEnabled`가 없는데, **일부러 그대로 둔다** — 사인오프 *요청*만 만들고 freeze는 사람 승인으로만 일어나므로(N7) 미검증 산출물에도 물어보는 편이 맞다. `worker.golden.test.ts`가 그 차이를 봉인한다. **advisory를 고치면서 golden까지 같이 바꾸지 않는다**
- **mutation 은 켜는 것만으로 돌지 않는다 — 손잡이가 둘이고 릴레이가 tsc 사각지대다.**
  `MANAGER_MUTATION_MIN_RISK`(기본 HIGH)는 **돌릴지**를, `MANAGER_MUTATION_THETA*`는 **얼마나 엄하게**를 정한다.
  분해가 만드는 WP 의 `risk` 는 스키마 기본값 **MEDIUM** 이고 이를 올리는 유일한 경로가 리스크 분류→사람 승인→
  `updateWpRisks` write-back 이라, 체인이 없으면 **항상 skip** 된다. **체인을 켜는 것은 필요조건이지 충분조건이
  아니다** — 분류가 실제로 HIGH 로 채점되고 승인까지 돼야 하며 그 채점은 **WP별**이다(프로젝트가 HIGH 여도
  지목되지 않은 WP 는 HIGH 가 아니다). 확실한 쪽은 min-risk 를 낮추는 것이다. per-tier θ 는 **기본값이 없다** —
  미설정이면 공통 θ(0.6)를 받아 동작이 변하지 않는다. **닿지 않는 조합은 둘이다**: min-risk 가 그 등급을 아예 거를 때, 그리고 risk 체인이 꺼져 전 WP 가 MEDIUM 에 머물 때(후자는 min-risk=HIGH 만 보는 G7 경고가 놓친다). 둘 다 기동 경고가 표면화한다.
  **θ 키를 바꿀 때 tsc 를 믿지 마라**: `server`→`supervisor`→`worker` 릴레이가 `...(x !== undefined && { x })`
  조건부 spread 라 초과 속성 검사가 적용되지 않는다 — 이름을 바꿨는데 `tsc --noEmit` 이 침묵했고 배선 3곳이
  옛 이름을 넘긴 채 θ 가 도달조차 못 했다. 지금은 `worker.test.ts` 가 하니스 plan 의 θ 값으로 릴레이를 봉인한다
- **`wp.risk`는 프로젝트 등급의 사본이 아니다.** 분류 아티팩트의 `risk` 는 **프로젝트 종합**이고 `wpRisks` 가 **WP 판정**이다 — write-back 은 후자만 쓰고 **판정이 없으면 아무것도 쓰지 않는다**(종합 등급을 전 WP 에 찍으면 mutation θ·DEGRADED 서명 게이트가 판단하는 척만 한다). 한 WP 에 걸리는 claim 은 전 WP 공통(`wpIds` 빈 것) + 그 WP 를 지목한 것이라, **분류기가 아무 판단도 못 하면 WP 등급 = 프로젝트 등급**이고, **낮아지는 유일한 길은 분류기가 claim 을 다른 WP 로 좁힌 것**이다(증거가 적어서 안전해지는 역설은 없다). LLM 이 없는 id 를 지어내면 지목을 버리고 전 WP 공통으로 **넓힌다** — 좁히는 쪽으로 잘못 가면 게이트가 풀린다
  기동 경고는 **`MUTATION + VERIFY + minRisk=HIGH + 체인 불완전`** 조합에서만 뜬다. VERIFY가 꺼져 있으면 다른 경고가 뜨고 채널은 애초에 검증 루프에 들어가지도 않는다.
- **lease 가시성은 자동 상향된다.** 활성 검증 채널이 요구하는 바닥값보다 설정값이 낮으면 기동 시 올린다(올리기만, 낮추지 않음). 채널을 여럿 켜면 WP당 에이전트 호출이 9단계까지 가므로 수동 상향은 불필요하지만 값이 바뀌었다는 로그는 확인한다.
- **Gherkin `then` 은 thenable 함정**이다 — Promise 로 오인돼 await 가 삼킨다. `thenSteps` 를 쓴다.
- **오라클 초안은 소비자 없이는 영속되지 않는다.** 초안 생성만 켜고 Supervisor(`TASK_MANAGER_ENABLED`+`DATABASE_URL`)를 끄면 emit 은 되는데 저장이 안 된다
- **`tsconfig.json`이 테스트 파일을 exclude한다.** 타입으로 호출부를 강제하는 장치는 `src/` 프로덕션 코드에만 성립하고 테스트 호출부는 검사되지 않는다.
- **userContext 를 넘기는 trigger 테스트는 `ensureWs` mock 을 반드시 주입**한다. 빠뜨리면 실제 `mkdir(workspaceRoot)` 가 돌아 Linux CI 에서 `EACCES` 로 죽는다(로컬 Windows 는 통과한다)
- **꺼진 채널도 결과를 기록한다 — 그 값이 게이트를 살리고 죽인다.** 검증 채널 5종은 기본 off 인데 `runChannelChecks` 가 그때도 `recordOutcome` 을 부른다. 그 값이 `skipped`(미증명)면 릴리스 게이트를 켜는 순간 **테스트를 통과한 WP 조차 영구 차단**된다 — 그래서 비대상은 `not_applicable` 로 기록한다. 이 결함은 유닛 1466건 초록 아래 숨어 있었다(게이트 테스트가 outcome 을 손으로 만들어 넣을 뿐 `verify.ts` 가 실제로 무엇을 기록하는지 본 테스트가 0개였다). **새 채널을 추가하면 비대상 분기의 기록값을 반드시 확인한다**
- **경계선: 켠 채널이 증명 못 한 것은 비대상이 아니다.** 판단 기준은 **누가 범위를 정했는가**다 — 설정·설계가 정한 범위 밖(플래그 off·min-risk 미달)이면 `not_applicable`, 범위 안인데 재료가 없으면 `skipped` 다. 운영자가 증명을 요구했는데 증명 없이 통과시키는 것이 이 게이트가 막으려는 것이다(한 번 반대로 넣었다가 Grok 반증이 잡았다)
- **분해 입력(`intent`)은 `graph_dag`에 함께 영속된다.** `userContext`와 같은 방식의 additive JSONB 필드다(마이그레이션 0). 이것이 없으면 `spec_fix`(재분해)가 돌릴 재료 자체가 없다 — `produceDecomposition(intent,…)`인데 intent 는 요청과 함께 사라졌었다. **`upsertGraph`는 graph_dag를 통째로 교체하므로** 재분해 발행이 intent를 안 실으면 유실된다 — 소비자가 병합 때문에 이미 읽은 기존 그래프에서 이월한다
- **핸들러 없는 choice 버튼은 그리지 않는다.** `buildDefectBrief`의 `options`는 결정 소비자가 **실제로 처리하는** choice만 나열한다 — 없는 것을 노출하면 눌러도 RESOLVED만 남는 거짓 affordance다. `spec_fix`는 핸들러가 배선된 경우에만(`specFixAvailable`) 노출되고, `accept_known`·`reject`는 여전히 빠져 있다
- **WP I/O 는 분해가 예측한 것이 아니라 실행이 실제로 낸 것이다.** 성공한 WP 의 결과 `artifacts` 가 `wp_outputs` 에 기록되고, 후행 WP 디스패치 시 `wp.dependencies` 의 산출물 합집합이 에이전트 입력이 된다. **`graph_dag` 의 `inputs`/`outputs` 는 채우지 않는다** — 그것은 계획이고 이것은 사실이라 한 자리에 쓰면 혼동이 생긴다. 이 배선 전에는 `buildWorkerInput` 이 `artifacts: []` 를 하드코딩해 **security static 이 구조적으로 항상 `requested: 0`** 이었다
- **DLQ·PEL 은 고정 키 목록으로 못 잰다 — `GET /metrics` 가 `SCAN` 으로 훑는다.** 스트림이 per-session·per-workflow 라 DLQ 키도 같이 는다. `KEYS` 는 단일 스레드 Redis 를 블로킹하므로 쓰지 않는다. **전부 보지 못하면 `..._truncated` 로 합계가 하한임을 드러낸다** — 잘라내고 전량인 척하는 것이 관측의 최악이다. SCAN 은 같은 키를 두 번 줄 수 있고, `TYPE stream` 은 SCAN 시점만 보장한다(스트림별로 감싸지 않으면 키 하나가 `pais_redis_up 0` 이라는 거짓을 낸다). **`/metrics` 는 헬스체크가 아니다** — Redis 가 죽어도 **200 을 주고** 그 사실을 `pais_redis_up 0` 으로 노출한다. 실패 수는 `..._stream_errors` 가 따로 준다
- **`manager:events:{workflowId}` 는 소비자가 0이고 per-workflow 라 고정 이름 소비자가 붙지도 못한다.** `wp.verification.failed`·`decomposition.inconsistent` 가 여기로 간다 — 발행하면 관측된 것처럼 보이지만 **아무도 읽지 않는다**. 검증 실패 사유는 그래서 `wp_verification_failures` 에 따로 영속하고 에스컬레이션 브리프가 읽어 나른다. **새 이벤트를 얹을 때는 "누가 읽는가"를 먼저 답한다**
- **held-set 은 in-memory 다** — SAFE 모드 보류 디스패치는 재시작 시 소실된다.
- **마이그레이션 추적 테이블 이름의 `manager_` 접두사가 계약이다.** 런타임에 Orchestrator 와 같은 DB 를 쓰는데 그쪽이 이미 `schema_migrations` 에 자기 버전을 기록한다 — 접두사를 떼면 두 서비스의 버전 번호가 서로를 덮어 **예외 없이 조용히 마이그레이션을 건너뛴다**. 다른 테이블이 전부 `manager_` 인 것과 같은 이유다
- **버전 추적이 생겨도 멱등 가드는 남는다.** 추적 테이블이 없던 기존 DB 가 새 러너로 처음 뜨면 전량이 한 번 더 돈다 — 그 한 번을 안전하게 만드는 것이 `db/migration-guard.ts` 이고 `__tests__/migrate-idempotent.test.ts` 가 실제 파일을 훑는다. **`ADD CONSTRAINT` 와 이름 없는 제약, `CREATE TYPE` 은 Postgres 에 `IF NOT EXISTS` 문법이 없어** 카탈로그 조회 가드나 `DO $$ … EXCEPTION WHEN duplicate_object $$` 로 감싸야 한다. 가드 판정은 **블록이 아니라 IF 영역 단위**다
- **WP 상태 정본은 `@xzawed/agent-streams` 의 `types/wp-state.ts` 하나다**(S6.1). 여기 값을 다시 선언하지 않는다 — 이전엔 shared 소문자 enum 과 Manager 대문자 상수가 **교집합 0** 으로 갈려 있었고, 한쪽을 읽는 술어가 다른 쪽이 쓴 값을 영원히 못 봤다(`isReady` 의 `wp.status === 'done'` 기본 술어가 그랬다). `dispatch-constants.ts` 의 별칭은 `satisfies WpStatus` 로 드리프트를 tsc 에 노출한다.
- **`wp_state_log` writer 는 둘이고 둘 다 `assertWpTransition` 을 지난다**(`dispatch.repo.appendWpEvent` · `task-graph.repo.appendTransition`). **DB CHECK 와 이 가드는 다른 것을 막는다** — CHECK 는 값 집합만 보므로 `DONE → DISPATCHED` 처럼 값이 전부 유효한 불법 전이는 잡지 못한다. 새 writer 를 추가하면 가드를 함께 건다.
- **재분해는 진행 중 WP 를 보존한다.** 술어는 `wp.status` 가 **아니라** `latestStates`(`wp_state_log`)에서 온다 — `graph_dag` 의 status 는 프로덕션에서 영원히 `DRAFTED` 라 그것으로 판정하면 **항상 공집합**이고 그 위에 세운 유닛 테스트는 위음성이다(**pg 통합이 필수**). 병합 결과는 다시 `detectCycle` 한다 — 각각 비순환이어도 합집합은 순환일 수 있다
- **`graph_dag` writer 는 둘이고 둘 다 원자적이어야 한다.** `upsertGraph`(재분해)와 `updateWpRisks`(리스크 write-back). 후자는 원래 read-modify-write 라 그 사이에 재분해가 끼면 결과를 통째로 되돌렸다(lost update) — 단일 `UPDATE`+`jsonb_set` 으로 창을 없앴다. **새 writer 에 read-modify-write 를 쓰지 않는다**
- **트랜잭션 밖 `FOR UPDATE SKIP LOCKED` 는 무효**다 — 잠금이 즉시 풀린다.
- **소비자 그룹이 스트림을 공유하면 멱등 키에 그룹 성분을 넣어야 한다.** 없으면 한 그룹의 마커가 다른 그룹의 핸들러를 굶긴다.
- **세션 정리는 게이트웨이 경로에서만 의미가 있다.** `makeSessionStarter` 를 부르는 곳이 둘인데 프로덕션 진입은 `server.ts` 의 게이트웨이 starter 하나뿐이다 — 다른 하나가 만드는 라우트는 저장소에 호출자가 없어 테스트에서만 도달한다. 그래서 starter 의 `registry` 는 **필수이되 nullable** 이다(선택으로 두면 누락이 무음 no-op 이 되어 tsc 가 못 잡는다)
- **세션 종료는 에이전트에 통지해야 한다.** `registry.releaseAll` → `RedisAgentHandler.releaseSession` → 게이트웨이 `event:'end'`가 에이전트 쪽 세션 소비자와 그 전용 Redis 연결을 회수시키는 유일한 경로다. 이 체인 중 하나라도 끊기면 에이전트에 소비자가 무한 누적되고 1000개에서 신규 세션이 폐기된다.
- **RPC 타임아웃은 `_notifiedSessions` memo를 푼다.** 에이전트만 재시작되면 그 소비자는 사라졌는데 Manager는 "이미 통지했다"고 기억한다. 타임아웃이 유일한 감지 신호라 거기서 memo를 풀어 다음 호출이 재통지하게 한다.

## 헬스체크

`/health` 는 liveness(정적 200), `/health/ready` 는 readiness다. compose healthcheck 는 후자를 친다.
판정 코어는 `@xzawed/agent-streams` 의 `health/readiness.ts`(Orchestrator 와 `replicated-block`).

- **프로브 재료는 값이 아니라 접근자로 넘긴다** — `healthRoute` 등록이 `sessionGateway` 생성보다
  앞이라 값을 직접 주면 그 시점에 아직 없다
- **`HealthDeps` 필드는 전부 선택**이다 — 주지 않은 것은 검사 대상이 아니고 **하나도 주지 않으면 항상 ready** 다(기존 호출부 호환). DB 프로브는 `pool()` 이 null 이면 `not_configured` — prod compose 가 `DATABASE_URL` 을 주지 않으므로 이것을 실패로 세면 배포가 영구 unhealthy 다 DB 프로브는 `pool()` 이 null 이면 `not_configured` —
  prod compose 가 `DATABASE_URL` 을 주지 않으므로 이것을 실패로 세면 배포가 영구 unhealthy 다
- **readiness 의 Redis ping 은 전용 연결을 써야 한다.** 공유 클라이언트는 `StreamConsumer` 가
  `XREADGROUP … BLOCK 2000` 으로 점유하는데 ioredis 는 한 연결에서 명령을 **직렬화**하므로 그 위의
  `ping()` 이 readiness 예산 1000ms 를 **항상** 초과한다. 증상은 조용하고 치명적이다 — 세션이 없을
  때는 200 이다가 **첫 세션이 생기는 순간 영구 503**(실측 6/6 → 0/6 → 전용 연결로 10/10). compose
  healthcheck 는 30초×3 이라 **첫 대화 ~90초 뒤** 컨테이너가 unhealthy 로 뒤집히고 Launcher 가 그
  신호로 `running` 을 판정한다. **readiness 가 물어야 하는 것은 "Redis 가 닿는가"이지 "공유 연결이
  지금 한가한가"가 아니다** — 소비 루프 생존은 `loopProbe` 가 따로 본다
## 환경 변수 · 테넌트 태깅

**`packages/server/src/config.ts` 가 진실원천이다** — 64개 키의 이름·타입·기본값·전제 체인이
거기 있다(`grep -n "전제" packages/server/src/config.ts` 로 플래그 의존을 본다). 기동 거부
조건과 테넌트 태깅 상세는 [docs/services/manager.md](../docs/services/manager.md#환경-변수--기동-거부-조건).

- `ANTHROPIC_API_KEY` 는 **모든 모드에서 필수**다. 없으면 parse 단계에서 기동 실패
- `SERVICE_JWT_SECRET` 은 **설정했다면** 32자 이상이어야 한다(`MODE=local` 에서도)
- `MODE=remote` 면 `SERVICE_JWT_SECRET` 이 **있어야** 한다(무인증 mutation 개방 차단)
- `PAIS_PROFILE=autonomous` 면 `SERVICE_JWT_SECRET`·`DATABASE_URL` 둘 다 필수. 미지 프로필은 throw

## 참고

- 저장소 공통 규칙·보안 원칙·PR 워크플로 → [루트 CLAUDE.md](../CLAUDE.md)
- 무엇이 기본 실행되고 무엇이 플래그 뒤인지 → [`docs/LIVE_VS_FLAGGED.md`](../docs/LIVE_VS_FLAGGED.md)
