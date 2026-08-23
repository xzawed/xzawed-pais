# Live vs Flagged — 기본 실행 경로 vs 플래그 게이트 기능

> **왜 이 문서인가:** 루트·서비스 `CLAUDE.md`의 "✅ 상태"·상세 서술은 **머지되고 테스트된 모듈**을 뜻하며, 그중 상당수는 **플래그 뒤에서 기본 off**다. 이 문서는 "기본 배포에서 실제로 도는 것"과 "플래그를 켜야 도는 것"을 정직하게 구분한다. 마케팅·지원·온보딩이 휴면 기능을 출하 기능으로 오인하지 않도록 하는 단일 진실원천이다.
>
> 근거: [Claude⊕Grok 프리미엄 준비도 공동 검증](analysis/claude-grok-premium-verification.md) G4. 플래그 정의는 `xzawedManager/packages/server/src/config.ts`.

## TL;DR

- **기본값(플래그 0·선택적 DB)** = 신중한 **대화형 챗 오케스트레이터**: 사용자 의도 → Manager Claude tool-loop → 에이전트 RPC → **사람 승인 게이트**. 이것이 프로덕션-검증된 상시 경로다.
- **자율 "소프트웨어 팩토리" 아크**(분해→디스패치→워커→검증→릴리스/배포·의사결정 대기함)는 **전부 플래그 게이트·기본 off**. 코드는 완성·테스트됐으나 운영자가 스위치를 켜야 돈다.
- **한 스위치로 켜기**: `PAIS_PROFILE=autonomous`(Manager+Orchestrator)가 검증된 correctness-floor 스택을 켜고 `SERVICE_JWT_SECRET`·`DATABASE_URL`을 강제한다. → [PAIS_PROFILE 설계](superpowers/specs/2026-07-18-pais-profile-design.md).

## 기본 배포에서 사는 것 (Live · 플래그 불필요)

| 기능 | 전제 | 근거 |
|---|---|---|
| Orchestrator 챗 UI(Electron)·세션·WS | — | `xzawedOrchestrator/` |
| Manager Claude tool-calling 루프(대화형 디스패치) | `ANTHROPIC_API_KEY` | `claude/runner.ts` |
| 사람 **승인 게이트**(fail-safe·미지 응답→사람 재검토) | `MANAGER_GATE_FAILSAFE`(기본 **true**) | `gates/approval-gate.ts` |
| 에이전트 RPC(plan/develop/design/test/build/watch/security)·Redis Streams | Redis | 각 에이전트 서비스 |
| AgentQuery 교차질의 라우팅 | — | `runner.ts` |
| 도메인 위키(누적·주입·조회) | `DATABASE_URL`(없으면 미제공) | `db/knowledge.repo.ts` |
| Launcher 5단계 설치 마법사(self-host 온보딩) | — | `xzawedLauncher/` |
| 실검사 readiness(`/health/ready`, 9개 서비스) — compose healthcheck 가 친다 | — | `xzawedShared/src/health/readiness.ts` |

## 플래그를 켜야 사는 것 (Flagged · 기본 off)

> 전제는 사다리식으로 쌓인다. 부분 활성은 (기동 경고는 뜨지만) 무음 stall처럼 보일 수 있다 — `PAIS_PROFILE` 사용 권장.

| 기능군 | 플래그 | 기본 |
|---|---|---|
| **자율 Task Graph 아크**(분해 생산자→Supervisor 디스패치·lease·워커→완료 재디스패치) | `ORCHESTRATOR_DECOMPOSE_ENABLED`(Orch)·`MANAGER_DECOMPOSE_ENABLED`·`TASK_MANAGER_ENABLED`·`MANAGER_TASK_WORKER` (+`DATABASE_URL`) | off |
| **WP 검증 게이트**(실행 ground-truth·fail-closed) | `MANAGER_WP_VERIFY` | off |
| **고급 검증 채널**(conformance/impact/property/mutation/security) | `MANAGER_WP_CONFORMANCE`·`_IMPACT`·`_PROPERTY`·`_MUTATION`·`_SECURITY` | off · **사람 시드 오라클/golden·risk 승인 필요**(없으면 skip/차단) |
| Advisory(비차단 optimization 큐) | `MANAGER_WP_ADVISORY` | off |
| **사람 의사결정 아크**(결함 브리프·라우팅·만료·C1 대기함 데이터) | `MANAGER_DECISION_BRIEF`·`_ROUTING`·`_EXPIRY` | off |
| Oracle DoR·초안·승인·invariants | `MANAGER_ORACLE_DOR`·`_DRAFT`·`_DECISION`·`_INVARIANTS` | off |
| 리스크 분류·라우팅·승인 | `MANAGER_RISK_CLASSIFY`·`_ROUTING`·`_DECISION` | off |
| 모델 라우팅(opus/sonnet) | `MANAGER_MODEL_ROUTING` | off |
| 릴리스 게이트·사인오프·**배포 게이팅** | `MANAGER_RELEASE_GATE`·`_SIGNOFF`·`MANAGER_DEPLOY_GATE` | off |
| Golden freeze 사인오프 | `MANAGER_GOLDEN_SIGNOFF` | off |
| 강등 모드(추적·enforce·사인오프) | `MANAGER_DEGRADED_MODE`·`_ENFORCE`·`_SIGNOFF` | off |
| 세션 이벤트소싱(replay 복원) | `EVENT_SOURCED_SESSION` | off |
| §13 서킷(budget·provider·bulkhead) | `MANAGER_BUDGET_*`·`MANAGER_PROVIDER_CIRCUIT`·`MANAGER_BULKHEAD_*` | off(0) |

## `PAIS_PROFILE=autonomous`가 켜는 것 (검증된 floor)

`TASK_MANAGER_ENABLED`·`MANAGER_DECOMPOSE_ENABLED`·`MANAGER_TASK_WORKER`·`MANAGER_WP_VERIFY`=true + 비용 캡(`MANAGER_BUDGET_PER_WORKFLOW_USD=5`·`DAILY=50`) + **`SERVICE_JWT_SECRET`(≥32)·`DATABASE_URL` 하드요구**(없으면 기동 거부). Orchestrator엔 `ORCHESTRATOR_DECOMPOSE_ENABLED=true`. (lease 가시성은 G8 auto-tune이 활성 채널에 맞춰 자동 상향 — 수동 `MANAGER_LEASE_VISIBILITY_MS=600000` 불필요.)

**의도적 미포함**(정직성): 고급 검증 채널·decision/oracle/risk 체인은 사람 시드 데이터가 있어야 의미가 있어 **opt-in**으로 남긴다 — 프로필은 "돌아가고 + 기본 검증"까지만 켠다.

## CLAUDE.md의 "✅ 상태"를 읽는 법

서비스 표·상세의 ✅·기능 서술은 **"머지·테스트 완료"**를 뜻하지 **"기본 배포에서 활성"**을 뜻하지 않는다. 자율/검증/의사결정 관련 서술은 위 "Flagged" 표를 함께 보라. 어떤 SKU를 파느냐(챗 어시스턴트 vs 자율 팩토리 vs 멀티테넌트 SaaS)에 따라 켤 플래그가 다르며, 후자로 갈수록 [공동 검증 보고서](analysis/claude-grok-premium-verification.md)의 미해결 갭(멀티테넌시·과금·SLO)이 추가로 필요하다.

> **⚠️ G11 멀티테넌시 = 전파 토대 완성·아직 강제 아님(정직성):** Tier-2 G11 Slice 0(위키·결정 프록시 IDOR 폐색)·Slice 1(tenants+users.org_id+JWT orgId claim)·Slice 2(projects.org_id·소유권 org-우선)·Slice 3(UserContext.tenantId 캐리어·Orchestrator→Manager 전파)·**Slice 4(Manager 쓰기 태깅)**은 머지됐으나 **신원 확립 + 전파 + 쓰기 태깅까지만**이고 **테넌트 데이터 격리는 아직 강제하지 않는다**(enforcement 0 — tenantId가 토큰·UserContext·graph_dag로 흐르고 Manager가 쓰는 10개 테이블(`task_graphs`·`wp_state_log`·`wp_leases`·`oracles`·`decision_requests`·`risk_classifications`·`advisory_findings`·`wp_verification_results`·`release_gates`·`domain_knowledge`) 행에 `tenant_id`를 기록하지만, **읽기 술어가 0줄**이라 어떤 Manager 쿼리도 tenant로 필터하지 않음 — **격리가 아니라 태깅**이다). Slice 4는 플래그 없이 항상 켜짐(migration 017·백필·인덱스 0). ⚠️ **태깅조차 전부가 아니다**: `oracles`는 두 writer 중 분해 경로(`upsertDraft`)만 태그되고, 사람 `POST /oracles` 시드 경로(`upsert`)는 Manager에 `authUser`가 없어(C6) 태그 소스가 없다 — 이 경로로 들어오는 golden/invariant/oracle 행은 영구 NULL이며, Slice 4b가 오라클 읽기에 술어를 얹기 전에 별도로 해결해야 한다. 실제 테넌트 데이터 경계(Slice 4b — 읽기 술어)·per-tenant 비용 격리(Slice 5)·팀/RBAC·과금·SLO는 후속. **"멀티테넌트 SaaS 준비 완료"로 오인 금지** — 현재는 단일 사용자 경로가 바이트 동일이고 데이터 격리 enforcement는 미완이다.

## oracle-tier 쓰기 라우트의 소유권 공백 (정직성)

`SERVICE_JWT_SECRET` 미설정 시 knowledge·oracle·risk mutation 라우트가 무인증으로 열린다는 것은 이미 기동 로그가 경고한다. **여기 적는 것은 그다음 층이다 — JWT가 설정돼 있어도 남는 공백.** 세 지점 모두 서비스 JWT 보유만 확인하고 대상의 귀속을 확인하지 않는다.

| 지점 | 받는 스코프 | 공백 |
|---|---|---|
| `PATCH /oracles/:oracleId/approve` (`api/oracle.route.ts`) | `oracleId`뿐 | 프로젝트·워크플로 파라미터가 **라우트에 존재하지 않는다.** 대조할 스코프가 없어 소유권 검사를 넣을 자리도 없다 |
| `PATCH /workflows/:workflowId/risk-classification/approve` (`api/risk.route.ts`) | `workflowId` | 호출자가 그 워크플로에 귀속되는지 확인하지 않고 `riskRepo.approve`로 직행한다 |
| `DecisionRepo.hasApprovedReleaseSignoff(workflowId)` (`db/decision.repo.ts`) | `workflow_id` + `type='degraded_release'` + `scope='release'` | **deploy 게이트 우회 근거**로 쓰인다(`tools/deploy-gate.ts`). `type` 술어는 보강했지만 **테넌트·프로젝트 스코프는 여전히 없다** |

셋 다 **G11 Slice 4 태깅으로 고쳐지지 않는다** — 태깅은 쓰기에 `tenant_id`를 남길 뿐이고 이 라우트들은 판정 시점에 스코프를 대조하지 않는다.

**근본 원인은 빠진 술어가 아니라 호출자 신원의 부재다.** Manager의 유일한 인증 수단은 `auth/jwt.plugin.ts`의 `verifyServiceToken`이고, 그것은 `req.jwtVerify()`만 불러 **서비스 토큰임만 확인한다** — 사용자·조직 claim을 읽지 않는다. `ownership`·`assertProject*` 검색은 Manager `src` 전체에서 0건이다(Orchestrator에는 `auth/ownership.ts`의 `projectOwnershipPreHandler`가 있다). `oracles`에는 `workflow_id`·`tenant_id`가, `risk_classifications`에는 `project_id`까지 **이미 있다** — 즉 마이그레이션이 모자라서 못 고치는 게 아니라, 그 컬럼과 비교할 호출자 신원이 없어서 못 고친다.

따라서 이 셋은 **사용자·조직을 실은 토큰이 Manager에 도달하는 슬라이스(Slice 4b 계열)에 묶여 있다.** 그 전에 라우트에 술어를 덧대면 보안 이득 없이 "닫혔다"는 착시만 남는다.
