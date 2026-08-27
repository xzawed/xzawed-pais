# 불변식 (M1~M9 · N1~N8)

프로덕션 코드 주석이 `M8`·`N6` 같은 라벨로 계속 가리키는 것들의 **정본 정의**다.

> **왜 여기 있나.** 이 라벨들은 원래 별도 비공개 저장소(`xzawed/xzawed-pais-senario`)의
> `xzawedPAIS_handoff_spec.md` §1 에만 정의돼 있었다. 그 저장소는 `docs/senario/` 로 gitignore 라
> **이 저장소를 clone 한 사람에게는 존재하지 않는다** — 코드 54개 파일이 정의되지 않은 용어를
> 가리키고 있었다. 정본을 여기로 옮긴다. 앞으로 이 파일이 정본이고, senario 스펙은 출처다.

**표에 "강제"라고 적힌 것만 강제된다.** 원문은 선언문(Non-negotiable)이라 전부 당위로 읽히지만,
실제로 무엇이 걸리는지는 실측해야 안다. 아래 "강제 지점" 열은 코드를 대조한 결과이고,
**"규약"** 은 사람이 지키기로 한 것이지 기계가 막는 것이 아니라는 뜻이다.

## 미션

WBS로 분해된 작업을 전문 에이전트가 나눠 수행하고, **사람이 승인한 의도와 동일하게 구현됐음이
검증된 것만** CI/CD로 내보내, 라이브 서비스 사용자에게 결함이 도달하지 않게 한다.

## MUST

| ID | 불변식 | 강제 지점 | 기본 태세 |
|---|---|---|---|
| **M1** | CI/CD(빌드·배포)는 **fail-closed 릴리스 게이트** 뒤에서만. TC 통과 + 품질·보안 검증이 하드 전제 | `streams/release-gate.ts` · `tools/deploy-gate.ts` | **휴면** — `MANAGER_RELEASE_GATE`·`MANAGER_DEPLOY_GATE` 기본 off. 켜면 strict 가 기본 true |
| **M2** | "의도와 같은 동작"의 오라클은 **사람이 정의·승인**한다. 에이전트는 제안·대조만 | `db/oracle.repo.ts`(`human_approved` 만 계수) · `task-graph/oracle-dor.ts` | 휴면 — `MANAGER_ORACLE_*` 기본 off |
| **M3** | 에이전트 간 통신은 **Event Bus 메시지 패싱만**. 직접 import 금지 | **강제** — CI `module-boundaries` 잡(dependency-cruiser), `all-checks-pass` 필수 | **상시** |
| **M4** | Orchestrator는 **stateless**. 워크플로 상태는 내구적 저장소에 | `db/event-store.ts` · `manager_events` | **조건부** — `msgRepo` 미주입 시 `messageStore: Map` 인메모리 폴백(`sessions.route.ts`). DB 있을 때만 성립 |
| **M5** | 상태 변경과 이벤트 발행은 **트랜잭셔널 아웃박스**로 원자화(dual-write 금지) | `migrations/006_events_outbox.sql` · `streams/outbox-relay.ts` | DB 있을 때 |
| **M6** | 모든 에이전트 작업은 `(workflow_id, step_id, attempt_id)` 로 **멱등** | `types/event-envelope.ts` `idempotencyKey` · shared `BaseConsumer` dedup | **상시**(shared 소비자 경로) |
| **M7** | 모든 이벤트는 `correlationId` + `causationId` 로 **분산 트레이스**를 형성 | `types/event-envelope.ts` — `correlationId` 는 `.min(1)` 필수, **`causationId` 는 `.nullable()`**(루트 이벤트는 원인이 없다) | **강제**(Zod). 단 `causationId: null` 은 유효한 값이라 "인과가 항상 있다"로 읽으면 안 된다 |
| **M8** | 모든 실패는 **에스컬레이션 사다리**를 따른다. 무음 실패·하드 크래시 금지, 항상 *알려진* 강등 모드 | 소비자 DLQ 격리 · `recordOutcome` · 기동 경고 | **상시** — 코드 14개 파일이 이 라벨을 인용 |
| **M9** | 사람의 결정·사인오프는 **append-only·귀속·부인방지** 기록이며 **권한(authority) 검증 하에서만** 효력 | `migrations/011_decisions.sql` · Orchestrator `api/decisions.route.ts` · Manager `api/decision.route.ts` | **세 조각이 서로 다르다** — 귀속은 **경로별**(Orchestrator 경유는 JWT `sub` 로 덮어쓰기, Manager 직행은 body 값 신뢰), append-only 는 **규약**(DB 에 `REVOKE`·트리거·룰 없음), **권한 검증은 없다**(아래) |

## MUST NOT

| ID | 불변식 | 강제 지점 | 기본 태세 |
|---|---|---|---|
| **N1** | LLM이 "테스트 통과"를 **선언**해서 게이트를 열지 않는다. TC 통과 = 실제 실행 결과 | `streams/verify.ts` `judgePrimaryResult` — `run_tests` 실행 결과 필드로만 판정 | 검증 게이트가 켜졌을 때 |
| **N2** | 강등 모드에서 고위험 릴리스를 자동 통과시키지 않는다 → 사람 사인오프 | `streams/dispatch.ts` — DEGRADED + HIGH-risk WP 는 서명 요구 | 휴면 — `MANAGER_DEGRADED_*` 기본 off |
| **N3** | advisory(개선 가능)를 blocking(결함)과 같은 채널에 섞지 않는다 | `db/advisory.types.ts` — `severity: z.literal('advisory')`, verdict 경로 미유입 | **구조적** |
| **N4** | 분해·재분해가 진행 중인 git 브랜치를 다시 쓰지 않는다 | `decomposition/content-hash.ts`(risk 제외 → id 안정) · `mergeKeepInflight` | **상시** |
| **N5** | 결함 국소화·재분해 루프를 무한히 돌리지 않는다. 임계에서 사람에게 에스컬레이션 | `attributionCounters` · `MANAGER_DECISION_REESCALATE_MAX` | 결정 체인이 켜졌을 때 |
| **N6** | AI 자기검증·다중 에이전트 투표는 **추가 신호일 뿐** M2·N1 을 대체·완화하지 않는다 | `verify.ts` security 채널 — 결정론 findings(`static`·`deps`)만 게이트, LLM findings 제외 | **구조적** — 코드 10개 파일이 인용 |
| **N7** | 에이전트는 **골든 레퍼런스를 자동 갱신하지 않는다.** 신규 골든은 사람 승인으로만 | `db/oracle.repo.ts` `freezeGoldensByWorkflow` | 오라클 체인이 켜졌을 때 |
| **N8** | **빈 껍데기 스위트로 게이트를 열지 않는다.** mutation score < θ 면 닫힘 또는 사람 사인오프 | `verify.ts` — `passed <= 0` vacuous 차단(상시) + `runMutationCheck`(플래그) | 앞은 **상시**, mutation 은 휴면 |

## 읽는 법 — 두 가지 함정

**"강제 지점이 있다"와 "지금 걸린다"는 다르다.** 자율 스택은 **전부 플래그 뒤에 있고 기본 off** 다
(→ [LIVE_VS_FLAGGED](../LIVE_VS_FLAGGED.md)). M1·M2·N2·N7 은 코드가 있어도 기본 구성에서는 돌지
않는다. 그것이 결함이 아니라 **선언된 태세**다 — 대화형 챗 + 사람 승인 게이트가 기본이다.

**"규약"은 다음 사람이 깨뜨릴 수 있다 — 이미 한 번 그랬다.** M9 의 append-only 는 DB 가 막지
않는다(`REVOKE`·트리거·룰 0건). 런타임 코드의 위반은 0건이지만 **마이그레이션 `018_wp_state_contract.sql`
은 `wp_state_log` 를 실제로 `UPDATE` 했다** — S6.1 이 WP 상태 정본을 통일하면서 레거시 `IN_PROGRESS`
행을 `DISPATCHED` 로 정규화해야 `ADD CONSTRAINT` 가 통과했기 때문이다.

그 변경 자체는 정당했다(제약을 붙이려면 값 집합을 먼저 맞춰야 한다). 기록해 두는 이유는 **"append-only
니까 과거 행은 절대 안 바뀐다"를 전제로 감사 추론을 하면 틀린다**는 것이다. 스키마 마이그레이션은
그 규약 밖에 있고, 앞으로도 그럴 것이다 — 런타임 writer 만 규약의 대상이다.

이 문서를 처음 쓸 때 나는 "프로덕션 `UPDATE`/`DELETE` 0건"이라고 적었다. `--include=*.ts` 로만
grep 해서 `.sql` 을 놓친 것이고, Grok 반증이 잡았다. **불변식 문서가 코드보다 많이 주장하면
그 문서가 곧 다음 사고의 원인이 된다.**

## M9 의 권한 절 — 컬럼은 있고 검증은 없다

이 문서 초판은 M9 에서 **"권한 검증 하에서만 효력"이라는 절을 통째로 빠뜨렸다.** 정본 파일이
조항을 지우면 그 조항은 시야에서 사라지고, 지켜지지 않는다는 사실조차 남지 않는다. 복원하고
실제 상태를 적는다.

**`human_decisions.authority` 와 `sign_offs.authority_level` 은 죽은 컬럼이다**(2026-08-27 실측,
Grok 반증 통과).

- **값을 넣는 프로덕션 호출부가 0개다.** `recordDecision` 은 `api/decision.route.ts` 한 곳,
  `recordSignOff` 는 `streams/decision-consumer.ts` 두 곳뿐이고 세 객체 리터럴 어디에도 그 키가
  없다. Zod 기본값이 `null` 이라 **모든 행이 NULL 로 들어간다**
- **읽고 판정하는 곳도 0개다.** 비교·분기·게이트 등장 0건. 릴리스·강등 사인오프 조회는
  `scope` 와 요청 `type` 으로만 조인한다
- `authority_level` 은 **행 매핑조차 없다**(`rowToSignOff` 부재)
- `011`~`020` 마이그레이션에 `DEFAULT`·트리거·후속 채움 없음. 클라이언트 입력 경로도 없다

**"귀속이 강제된다"도 경로를 봐야 한다.** 두 진입점의 신뢰 모델이 다르다.

| 경로 | `decidedBy` 출처 | 게이트 |
|---|---|---|
| Orchestrator 프록시 | **인증 사용자의 JWT `sub`** — client 가 보낸 값은 버린다 | `userAuthHook`(= `dbPool` + `userJwtSecret`) 주입 시 사용자 JWT. 미주입이면 POST 가 무인증이고 `decidedBy` 는 `'local-user'` 로 떨어진다. 소유권 게이트는 `userAuthHook` **과** `pool` 이 둘 다 있을 때만 |
| Manager 라우트 직행 | **요청 body 값을 그대로** (`z.string().min(1)`) | `shouldWireDecisionRoute(routing, hasPool, hasAuth)` 가 `'wire'` 일 때만 등록된다 — `MANAGER_DECISION_ROUTING` · DB pool · 서비스 JWT(`SERVICE_JWT_SECRET`) **셋 다** 필요. 셋째만 빠지면 `'warn'`(경고 후 미등록), 앞 둘이 빠지면 `'skip'`(조용히 미등록). **무인증 등록 경로는 없다** |

즉 신원 위조 방어는 Orchestrator 경계에 있고, Manager 쪽 신뢰 경계는 **"서비스 토큰을 가진
호출자는 신원을 주장할 수 있다"** 이다. 무인증 노출은 없지만(라우트 미등록), 문서가 "항상 JWT
주체로 귀속된다"고 읽히면 틀린다.

그리고 어느 경로든 막혀 있지 않은 것은 **"그 신원이 이 결정을 낼 자격이 있는가"** 다.

**함정.** repo 타입은 이미 `authority?: string | null` 을 **받는다**. 누군가 값을 넘기기 시작하면
스키마 변경 없이 조용히 채워지고, 그 순간 "권한이 기록되니까 검증된다"는 오독이 생긴다.
**기록과 검증은 다르다.**

### 결정 — 지금은 도입하지 않는다 (2026-08-28)

**사람 결정: 팀 초대 기능을 뒤로 미루고 권한 모델도 계획 단계로 둔다.** 안정성 확보가 우선이다.

그 결정이 오늘 안전한 이유는 실측됐다 — **org 에 두 번째 사용자를 붙이는 코드 경로가 0개**다.
가입(`user.repo.create`)이 매번 새 `tenants` 행을 만들고 invite·addMember·joinOrg 구현이 없다.
따라서 org 당 멤버는 실질적으로 1명이고, 소유자와 행위자가 갈리지 않는다.

**다만 규약이지 불변식이 아니다.** `users.org_id` 에 `UNIQUE` 가 없고 프로젝트 게이트는 이미
org 스코프(`WHERE id = $1 AND org_id = $2`)라, **누군가 `users.org_id` 에 기존 org 를 쓰는 순간**
그 org 의 모든 멤버가 모든 결정·사인오프를 낼 수 있게 된다 — 스키마 변경조차 필요 없다.

그래서 **이 절은 지금 코드가 지키지 않는다는 사실을 남긴 채로 둔다.** 지우지 않는 이유는
지워 버리면 팀 초대를 넣는 사람이 이 전제를 다시 발견해야 하기 때문이다.
**팀 초대는 이 결정 다음이다** — 선후를 뒤집으면 위 창이 열린 채로 나간다.

선택지와 강제 지점 후보는 아래 "출처"의 `OPEN_DECISIONS.md` D-1 에 있다.

## 출처

원문은 `xzawed/xzawed-pais-senario` 의 `xzawedPAIS_handoff_spec.md` §1(v5). **비공개 저장소이고
여기서 `docs/senario/` 로 gitignore 라 이 저장소를 clone 해도 없다** — 그래서 정본을 이 파일로
옮겼다. 저쪽은 이제 **"아직 코드가 아닌 것"만** 두는 pre-code 저장소다(로드맵·상태 원장 제거됨).

거기서 지금도 볼 것은 둘이다.

- **`OPEN_DECISIONS.md`** — 열려 있는 사람 결정. 지금은 위의 **M9 권한 절(D-1)** 하나다.
  **이 불변식들이 코드보다 많이 주장하게 되는 지점이 거기 모인다** — M9 를 손대기 전에 본다
- 확정 설계 문서 5종 — `ORACLE_SCHEMA` · `VERIFICATION_ADVERSARIAL_STRATEGY` ·
  `WIKI_AGENT_RISK_CLASSIFICATION` · `HUMAN_DECISION_PERSISTENCE` · `OPERATIONS_DECISIONS`.
  **설계 근거**로만 읽는다(구현 여부는 코드에서 측정한다)
