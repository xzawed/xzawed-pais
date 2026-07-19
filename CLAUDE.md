# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 플랫폼 개요

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획 → 개발 → 디자인 → 테스트 → 빌드 → 모니터링을 자동으로 수행한다.

**모든 서비스는 이 단일 저장소에서 관리된다.** 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

전체 API·가이드·설계 스펙은 [`docs/`](docs/README.md)를 참고한다.

> **⚠️ Live vs Flagged (정직성):** 아래 표·상세의 "✅ 상태"와 기능 서술은 **머지되고 테스트된 모듈**을 뜻하며, 자율 Task Graph 아크·검증 채널·의사결정/오라클/리스크/릴리스/배포/강등 체인은 **전부 플래그 뒤에서 기본 off**다("✅"≠"기본 배포에서 활성"). 기본값은 신중한 **대화형 챗 오케스트레이터 + 사람 승인 게이트**이며, 자율 스택은 `PAIS_PROFILE=autonomous`(+`JWT`/`DB`)로 켠다. **무엇이 기본 실행되고 무엇이 플래그 게이트인지는 [docs/LIVE_VS_FLAGGED.md](docs/LIVE_VS_FLAGGED.md)를 단일 진실원천으로 본다** — 마케팅·지원·온보딩이 휴면 기능을 출하 기능으로 오인하지 않도록.

## 서비스 전체 현황

| 서비스 | 포트 | 상태 | 역할 | 상세 |
|---|---|---|---|---|
| xzawedOrchestrator | 3000 | ✅ ~797건(+E2E 110건) | 사용자 지시 수신·정제 후 Manager에 전달; GitHub·MCP·Plugin 통합 Electron UI; 승인 게이트 UI(저장 전 summary 편집·전역 게이트 모드)·도메인 위키 뷰어(쓰기 인증)·**C1 결정 대기함**(프로젝트 pending 결정 프록시·DecisionsPanel 결함 브리프 카드·핸들 가능 choice만 노출·**JWT decidedBy 비부인** #306); 인증(JWT·Rate Limit·Refresh); i18n(ko/en/ja)·**C5 리스크 승인 surface**(DecisionsPanel context.options 구동 렌더로 risk_classification 결정 카드 표시·stale "기록만" 라벨 부채 해소·#318)·**Tier0 결정 UI 정직화**(defect_brief 옵션을 핸들러 있는 choice로 트림(D10)·결정 카드 type 배지 4종 #333)·**C6 인텐트 라우터**(재감사 키스톤 — 명시 `mode:'build'` 신호 시 대화형 runner 스킵·원 요청을 `decompose_request`로 발행해 휴면이던 자율 태스크그래프 아크를 라이브 경로에서 처음 생산 가능하게·`buildUserContext` DRY·`ORCHESTRATOR_DECOMPOSE_ENABLED` off→chat byte-identical·Manager 변경0·#337)·**UI 모드 토글**(C6 후속 — 입력창 per-message Chat\|Build 세그먼트 토글로 앱에서 자율 빌드 트리거·MessageInput sticky mode(기본 chat)→ChatView→postMessage `mode:'build'`(build일 때만 전송·chat byte-identical)·서버 변경0·#339)·**G10 sessions 비용 write rate-limit**(W14 — POST /sessions(10/min)·POST messages(30/min·LLM/decompose 비용 벡터)·POST ui-actions(60/min)에 `@fastify/rate-limit` 적용·GET 무제한·IP 키잉·auth와 공유 헬퍼 `registerLocalRateLimit`(CPD0)·스팸 비용 폭발·DoS 차단·#455)·**마이그레이션 인덱스 멱등화**(002/003/004 5개 CREATE INDEX→IF NOT EXISTS·out-of-sync 재실행 42P07 봉합·무DB 정적 가드·#457)·**G11 Tier-2 멀티테넌트 경계 착수**(모델 C·사용자당 단일 org·플랫폼 키+per-tenant 비용귀속: **Slice 0** 위키·결정 프록시 쓰기 소유권 게이트로 IDOR 폐색(#458)·**Slice 1** tenants+users.org_id+JWT orgId claim·개인 org 자동생성(#459)·**Slice 2** projects.org_id+assertProjectInOrg·소유권 게이트 org-우선 승격(#461)·**Slice 3** UserContext.tenantId 캐리어(buildUserContext→Manager UserContextSchema 보존→graph_dag 영속·`.strict()` 0곳이라 DLQ 위험 0·7 에이전트 무변경·#462)·전 슬라이스 enforcement 0 회귀0·Slice 4(Manager 술어 enforcement)~5·G12~G14 후속) | [CLAUDE.md](xzawedOrchestrator/CLAUDE.md) |
| xzawedManager | 3001 | ✅ 1291/1291(CI pg+redis 전체 통과·로컬 통합 skip) | Claude tool-calling 루프, 하위 에이전트 디스패치; 승인 게이트(재실행 산출물 포함·전역 모드·**fail-safe**: 파싱 불가·미지 응답은 자동 승인 금지·사람 재요청)·도메인 위키(쓰기 인증)·AgentQuery 교차질의 라우팅·**세션 이벤트소싱+트랜잭셔널 아웃박스**(append-only 진실원천·replay 복원, `EVENT_SOURCED_SESSION` flag 가역)·**Task Graph 영속**(task_graphs 가변 프로젝션+wp_state_log append-only, P1d-3)·**Task Graph 소비**(decomposition.emitted→결정론 빌드→정상 upsert / 사이클·구조오류 inconsistent 에스컬레이션, P1d-2, 미배선)·**Task Graph 디스패치**(readyNodes→wp.dispatched·step-N·DRAFTED→DISPATCHED 상태전이·M5 트랜잭셔널 아웃박스, P1d-4, 미배선)·**WP Lease**(wp_leases 가시성 타임아웃·dispatch 시 lease 획득·WP 고정 멱등키·PK dedup, P1d-5a; 만료 sweep→reclaim 재할당 attempt++·상한 초과 escalate·attempt CAS 동시성, P1d-5b, 미배선; **하드닝 하트비트 `renewLease`**: 워커가 실행 중 주기적 가시성 연장(status=active AND attempt CAS·events/outbox 미적재)으로 장기 검증 중 false reclaim 차단)·**WP 완료 흐름**(완료→lease release·DISPATCHED→DONE·후행 unblock 재디스패치·done-set을 latestStates 파생, P1d-6)·**Supervisor 런타임 배선**(decomposition→dispatch·lease sweep·completion→re-dispatch를 `TASK_MANAGER_ENABLED` flag 뒤로 server.ts 배선·shared 스트림·생산자 미도착이라 동작 준비, P1d-7)·**P2-3a 다단계 분해 생산자**(decompose_request→다단계 LLM 분해 epics→slice→독립 deliverables→roles→**P6 infer-edges**→커버리지 보고→decomposition.emitted, flag; **P6 간선·epicId: `inferStoryDependencies`(story-level 선행 의존)+`acyclicStoryDependencies`(순수 비순환 정제)→선행 story의 WP로 WP 간선 파생(FLAT 제거)·`epicRef`→`epicId` 전파(§7), 실패 시 FLAT degrade·단일 story 미호출**; **하드닝: pool 시 emission을 `createOutboxPublish` 트랜잭셔널 아웃박스 경유로 at-least-once·truth-source 정합**)·**P2-3b 자가수선**(P4 repair 루프·소진 시 inconsistent 에스컬레이션·세로슬라이스 린트)·**P3-1 Oracle DoR 게이트**(사람 승인 오라클→satisfied-set을 디스패치 readyNodes에 pull 주입·oracle.approved 트랜잭셔널 아웃박스→Supervisor 재디스패치·oracle API·`MANAGER_ORACLE_DOR` flag, ready→dispatched 첫 개방)·**P3-2 Oracle 초안 생성**(decompose ok 경로 P7 LLM 스테이지가 story별 GWT 시나리오 초안 생성·미커버 AC stub 보장·oracleDrafts additive emit→consumer `upsertDraft`(멱등 pending·`oracleIdFor` 단일출처)→approve가 drafted→human_approved 일괄 전이로 DoR 충족·oracleStore는 `DOR||DRAFT`로 주입(`shouldWireOracleConsumer` 분리)·`MANAGER_ORACLE_DRAFT` flag, 사람은 백지 작성 대신 승인 한 번)·**P4-1 실행 워커 골격**(dispatch/reclaim이 wp.dispatch_signal 발행→WorkerConsumer가 owningRole 에이전트 자율 호출→성공 시 wp.completion 발행→기존 완료 소비자가 DONE·후행 재디스패치, 실패=lease 백스톱·새 실패 이벤트 없음·`MANAGER_TASK_WORKER` flag, dispatch→lease→complete→re-dispatch 루프 첫 end-to-end 폐합)·**P4a-2 워크스페이스 컨텍스트 주입**(decompose_request `userContext` additive→그래프 영속(graph_dag JSONB·migration 0)→워커가 projectPath=workspaceRoot 절대경로+execute 3번째 인자로 주입→에이전트 resolveWorkspaceRoot 소비, NEW-2 해소·실 에이전트 성공 성립·미존재 시 placeholder 폴백 회귀 0)·**P4b-1 검증 게이트**(trivial 완료를 실행 ground truth fail-closed 검증으로 교체 — 결과-근거 판정(tester `success&&failed===0`·builder `success`·기본값 없는 minimal Zod)+develop_code 파생 빌드·테스트 실 재실행(fail-fast), 실패=완료 미발행→lease 백스톱 reclaim→escalate(N5 재사용)+`wp.verification.failed` 관측 이벤트 best-effort(M8), `MANAGER_WP_VERIFY` flag·N1·빈 스위트 vacuous pass는 P4b-3 `passed>0` floor로 봉합)·**P4b-2 Oracle conformance 검증**(develop_code WP 검증에 사람 승인 오라클 GWT를 실행 ground truth로 소비 — P4b-1 N6 한계(구현자가 게이트 명령 통제) 봉합: 독립 develop_code 호출이 승인 시나리오로 conformance 테스트 작성(`conf-author` 격리 세션·구현 수정 금지 지시)→Tester가 그 testFiles만 실행(`conf-run`)→결과-근거 판정, P4b-1 파생 체크 위 additive hard-AND·never-throw fail-closed·승인 오라클 부재면 skip·`approvedOracleForStory` 추가·`MANAGER_WP_CONFORMANCE` flag(전제 TASK_WORKER+WP_VERIFY+OracleRepo)·회귀 0)·**P4b-3 vacuous-pass 봉합**(verify.ts `judgePrimaryResult('run_tests')`에 `passed>0` floor — Tester 실행 통과 카운트를 살려 0-test가 `failed:0`으로 통과하던 빈 스위트·빈 conformance를 fail-closed 차단(primary·파생·conformance 균일)·N8 선행·전체 mutation score는 후속·`MANAGER_WP_VERIFY` 게이트 내·회귀 0)·**P4b-3 Oracle 스키마 확장**(invariants(§4)·golden_refs(§5) additive JSONB·migration 010·default []·현재 검증 미소비 — impact 채널 differential·property 채널 선결·회귀 0)·**DLQ 재처리 운영 라우트**(`POST /api/admin/dlq/redrive` → shared `redriveDlq`로 격리된 poison 메시지를 멱등 마커 선삭제 후 원 스트림 재발행·DLQ 제거, reason 필터·count 배치 상한·**인증 필수**(authHook 없으면 server.ts가 미등록 — open admin endpoint 금지), 잠복 하드닝)·**sessions.route 무음 drop 봉합(M8)**(handleConsumerMessage가 미처리 msg.type·decompose 비활성(`MANAGER_DECOMPOSE_ENABLED` off) 시 무음 auto-ack drop→요청자 무한 대기·consumer 누수하던 것을 명시 `error` 발행+세션 정리로 봉합·`cleanupSession`/`publishError` 헬퍼 추출)·**§13 budget 서킷브레이커**(shared `BudgetCircuitBreaker`를 러너 tool-loop에 배선 — 호출 전 누적 비용 `check`(워크플로/일 USD 상한 초과 시 fail-closed throw→error 발행 M8 stop)·호출 후 `record`(usage→USD)·트립 시 `app.log.warn` 알림, `MANAGER_BUDGET_PER_WORKFLOW_USD`·`MANAGER_BUDGET_DAILY_USD` env(0=비활성)·인메모리·P2/P4 병렬-비용 폭발 선제 보호·강등모드 P6 신호)·**§13 provider 서킷브레이커**(shared `ProviderCircuitBreaker`를 러너 tool-loop에 배선 — provider(Anthropic) 지속 장애(429/5xx/529·연결/타임아웃 duck-typing 분류)를 추적, 연속 실패 임계 도달 시 회로 open→cooldown 동안 `before` fail-fast(ProviderCircuitOpenError→error 발행)·성공 시 onSuccess 리셋·새로 open 시 `app.log.warn` 알림, `MANAGER_PROVIDER_CIRCUIT` flag+threshold/cooldown env·강등모드 P6 신호)·**§13 벌크헤드**(shared `Bulkhead`를 7개 에이전트 `RedisAgentHandler`에 공유 주입 — agentName(에이전트 종류)별 동시 RPC를 캡·초과 시 큐잉(백프레셔·드롭 없음)으로 한 종류 폭주가 다른 풀을 잠식 차단(§3), `MANAGER_BULKHEAD_GLOBAL`·`MANAGER_BULKHEAD_PER_AGENT` env(0=무제한)·미주입 시 직접 실행 회귀 0)·**P6 M9 의사결정 영속**(DecisionRequest/HumanDecision/SignOff — 사람 결정을 event-sourced·**append-only 불변·비부인** 영속·migration 011·`DecisionRepo` 단일 tx 아웃박스(M5/M7/M9)·전 쓰기 멱등(M6)·상태머신 가드·EXPIRED 비-무음 에스컬레이션(M8), #288)·**P6 결함 의사결정 브리프**(lease 상한 초과 escalation→`defect_brief` DecisionRequest 배선 — `handleLeaseSweep.onEscalated`+`buildDefectBrief`(§15·§4 choice)·**M9 첫 런타임 소비**·`MANAGER_DECISION_BRIEF` flag·best-effort·#291)·**P2r-2 리스크 분류 영속**(P2r-1 코어 산출 `RiskClassification` 프로젝션·**사람 승인 전이로 라우팅 확정**(N6 `approvedForWorkflow`)·migration 012·재채점=재승인·`RiskClassificationRepo`, 미배선); **P4 impact 채널(N8)**(검증 3채널 중 golden-differential — develop_code WP 산출물이 사람 사인오프 golden에서 벗어났는지 실행 검증·drift면 blocking·미소비 golden_refs 첫 소비·**N7 golden 읽기만**: 독립 develop_code가 differential 테스트 작성→Tester 실행·P4b-2 author→run을 `runAuthoredCheck<T>`로 일반화 공유(CPD0)·`MANAGER_WP_IMPACT` flag 회귀0)·**P4 property 채널**(invariants·conformance 렌즈 — develop_code WP가 사람 승인 불변식을 만족하는지 boundary+명시 속성 단언 테스트로 검증·위반 blocking·**N7 invariants 읽기만**·데이터 주도 채널 루프 hard-AND(`runAuthoredCheck<T>` 공유)·`MANAGER_WP_PROPERTY` flag 회귀0)·**P4 mutation θ_risk 게이트**(N8 강화·자가단언 하니스·HIGH-gate·`MANAGER_WP_MUTATION` flag 회귀0)·**P4 advisory 채널(N3)**(검증 3채널 중 optimization 렌즈 비차단 큐 — correctness 게이트와 분리·verifyWp 무지로 **N3 구조적 보장**: 워커가 verdict.ok 후 develop_code WP에 `produceAdvisory`(best-effort never-throw·runStage 재사용 LLM 1회→순위 findings) 호출→`AdvisoryRepo.recordFindings` 단일 tx 아웃박스(M5/M7)·migration 013·멱등(M6)·`MANAGER_WP_ADVISORY` flag 회귀0)·**P4 security 채널(4d)**(검증 correctness 게이트 다섯째 차단 채널 — develop_code WP 산출물에 결정론 SAST(static+npm audit) 직접 실행·`source∈{static,deps}`∧severity≥floor면 blocking·**LLM findings 제외(N6)**·SAST blocking·source-tagged·`runSecurityCheck`가 채널 루프 hard-AND 마지막 append·oracle 미소비·즉시 작동(휴면 아님)·`MANAGER_WP_SECURITY` flag 회귀0)·**P4 4c 결함 국소화(귀속 인식 에스컬레이션)**(escalate(impl 계층 소진)→`localizeFault`가 §11 결정론 귀속 라벨(`faultTier:'impl_exhausted'`·`counters{impl:attempt+1}`·LLM 0·N6)→`buildDefectBrief`가 `context.attribution`+§15 형태 채움·shared `AttributionCountersSchema` 재사용·`MANAGER_DECISION_BRIEF` 내·진동누적/graph_dag영속/재진입은 P6 후속·#298)·**P6 사람 결정 라우팅(§11 fix_reverify 폐루프)**(사람 `fix_reverify` 결정을 구현 재진입으로 되먹여 ESCALATED 종단 폐쇄 — `decision.recorded` 소비→`reopenLease`(escalated→active·attempt advance)→`dispatch_signal` 재발행·결정 제출 라우트(authHook 게이트·IDOR 404)·spec_fix/reject/accept_known은 매핑만(실동작 후속)·EXPIRED sweep·UI 카드 후속·`MANAGER_DECISION_ROUTING` flag·#299)·**P5-1 릴리스 게이트 코어(M1)**(all-WP-done 시 WP별 검증 증거 hard-AND 집계·fail-closed-on-absence(증거 부재/skip→CLOSED·design_ui 빈-plan 트랩 차단)·verify recordOutcome→wp_verification_results 영속→순수 evaluateReleaseGate→release_gates+gate.passed/blocked·migration 014·MANAGER_RELEASE_GATE flag·회귀0)·**C0 결정 프로젝트 스코프**(defect_brief DecisionRequest에 project_id 부여(migration 015)·lease `escalateOne`이 좁은 `GraphQueryPort`로 `getGraph().userContext.projectId` 조회(**never-throw N3**·lease escalation 비차단)→`buildDefectBrief` 스레딩·`DecisionRepo.pendingByProject`·`decision.route` 워크플로→프로젝트 스코프 리팩터(`GET /projects/:id/decisions/pending` open·`POST .../:requestId/decision` `existing.projectId!==projectId` IDOR 404)·신규 flag 없음(`MANAGER_DECISION_BRIEF`/`ROUTING` 재사용)·PR-B Orchestrator 결정 UI 토대·#303)·**P5-2a 릴리스 게이트 사인오프**(고아 `gate.blocked`를 `degraded_release` DecisionRequest로 라우팅 — `ReleaseSignoffConsumer`→`buildSignoffBrief`가 ReleaseGateResult를 **표준 DecisionContext로 매핑**해 C1 UI가 surface(**Orchestrator 변경 0**)→사람 `accept_known`→휴면 `recordSignOff` 첫 활성(**비부인 M9**·approver=인증 decidedBy·`scope='release'`)·`MANAGER_RELEASE_SIGNOFF` flag(전제 RELEASE_GATE+DECISION_ROUTING·**fail-closed**)·never-throw N3·멱등·gate.passed→deploy 게이팅은 P5-2b·#308)·**P5-2b 배포 게이팅**(릴리스 게이트/사인오프를 `deploy_project` **하드 전제**로 — execute 진입부 `ReleaseDeployGate.checkDeploy(projectId)`가 `latestGateByProject`(projectId→workflowId 역방향)→`blocked`면 `hasApprovedReleaseSignoff`(동일 workflowId·교차 적용 차단)→순수 `evaluateDeployGate` 판정·`blocked`+미사인오프면 throw; **fail-open-on-absence**(게이트 부재·`'default'` sentinel·조회 오류→허용·never-throw N3)·`MANAGER_DEPLOY_GATE` flag(전제 RELEASE_GATE+DATABASE_URL)·읽기전용(이벤트 0)·Orchestrator 변경 0·회귀 0·#310)·**P2r-3 리스크 분류 LLM 생산자**(P2r 체인 첫 살아있는 생산자 — 재감사 D2 루트블로커 해소: `decompose_request` 시 프로젝트 intent를 4차원으로 단일 LLM 조사→**결정론 인용검증**(`verifyCitations`: 무인용 폐기·`support=min(support,citations.length)` 클램프·차원당 cap)→순수 `scoreClassification`(P2r-1 코어)→`RiskClassificationRepo.upsert(pending)`·**범위=생산자만**(N6 미승인 — wp.risk write-back·mutation θ게이트 발화·승인 UI는 P2r-4 후속)·circuit-aware `runStage`로 budget/provider 서킷 **risk 스테이지만** 보호(러너와 동일 breaker 인스턴스 공유)·trigger `.catch` 구조 best-effort 격리(리스크 실패가 분해 절대 비차단)·migration 0(`012` 재사용)·이벤트 0(OutboxRelay 미변경)·`MANAGER_RISK_CLASSIFY` flag(전제 DECOMPOSE_ENABLED+DATABASE_URL)·회귀 0·#314)·**P2r-4 리스크 승인 라우팅+wp.risk write-back**(재감사 **mutation θ게이트 구조적 사망**(wp.risk 영구 MEDIUM→`meetsMinRisk(wp.risk,'HIGH')` 미발화) 단층 닫음 — 사람 PATCH approve→`RiskClassificationRepo.approve`(risk.approved)→OutboxRelay→`RiskApprovedConsumer`→`TaskGraphRepo.updateWpRisks`(read-modify-write·**version 불변**·**WP id 불변**(content-hash가 risk 제외 N4)·userContext 보존)→graph_dag WP risk=HIGH→mutation 게이트 발화·**opportunistic**(재디스패치 없음·risk는 readiness 무변)·**uniform**(전 WP)·승인 라우트(oracle-tier·authHook 쓰기보호)·**양쪽 silent-no-op seam 배선**(createSupervisor `riskRouting`+OutboxRelay 기동조건)·`MANAGER_RISK_ROUTING` flag(전제 TASK_MANAGER_ENABLED+DATABASE_URL)·migration 0·CI pg로 MEDIUM→HIGH 발화 실증·회귀 0·#316)·**C5 리스크 승인 UI(C1 결정 대기함 재사용)**(humanGate.required 리스크 분류를 `risk_classification` DecisionRequest로 발행→C1 UI surface→사람 승인(decidedBy=JWT subject·실 비부인)→`RiskClassificationRepo.approve`→wp.risk write-back→mutation·`buildRiskBrief` 표준 DecisionContext 매핑·decision-consumer approve 분기·`MANAGER_RISK_DECISION` flag(전제 MANAGER_RISK_CLASSIFY+MANAGER_DECISION_ROUTING+DATABASE_URL)·생산자/소비자 대칭 게이트·migration 0·#318)·**D5 모델 라우팅 소비(develop_code 수직 슬라이스)**(P2r 분류기가 산출·영속하던 `modelRouting`(RoutedAgent→opus/sonnet·§5)을 **워커가 처음 소비** — dispatch 시 승인 modelRouting 조회(never-throw `.catch(()=>null)`)→순수 `resolveWpModel`(owningRole→RoutedAgent→tier→concrete id·미매핑/미라우팅/badtier→undefined 폴백)→buildWorkerInput model 주입→developer `runner.generateChanges(model ?? this.model)`·HIGH→opus 격상·LOW→sonnet 절감 발화·server riskStore 게이트를 C5 `RISK_DECISION`→`(RISK_DECISION||MODEL_ROUTING)`로 확장·worker deps 4-way AND(`modelRouting && riskStore && opus && sonnet`)·모델id=operator-config 유래(LLM/payload 미주입)·`MANAGER_MODEL_ROUTING` flag+`MANAGER_MODEL_OPUS`(claude-opus-4-8)·`MANAGER_MODEL_SONNET`(claude-sonnet-4-6) env·off→바이트동일 회귀0·migration 0(`012` 읽기만)·**P2r 가치사슬 완성**(생산자#314→라우팅#316→UI#318→**모델소비#320**)·#320)·**B1 만료 결정 소비자(decision.expired 폐루프)**(#312가 발행하나 소비자 없던 `decision.expired`를 `DecisionExpiredConsumer`(별도 그룹 `manager-decision-expiry-consumers`)가 소비 → 만료 blocking 결정을 **바운드 재에스컬레이션**(`{base}:reesc{n+1}` 새 PENDING 재생성·orig wpId/projectId 복사→C1 `pendingByProject` 재노출·깊이는 requestId 접미사 `:reesc{n}` 결정론 인코딩)·상한(`MANAGER_DECISION_REESCALATE_MAX`·기본 1) 소진 시 구조적 warn 로그 종단·never-throw·`createRequest` ON CONFLICT+BaseConsumer dedup 이중 멱등·**group-scoped dedup 키**(두 그룹이 `manager:decision:main` 공유 시 그룹 성분 없는 멱등 마커 충돌로 한 그룹이 다른 그룹 handler 굶기는 결함 차단·shared 무수정)·`MANAGER_DECISION_EXPIRY` 재사용·migration 0·off→회귀 0·M8 무음 소실 폐루프·#322)·**G1 §13 서킷 decompose/advisory 배선**(budget/provider 서킷이 러너 tool-loop만 보호하던 것을 decompose 다단계 LLM(`runDecomposition` 7 스테이지)·advisory(`produceAdvisory`)로 확장 — `StageDeps.circuit?`+`runStage(deps,spec,circuit=deps.circuit)`+공유 `buildStageCircuit(workflowId, breakers)` 헬퍼(risk/decompose/advisory 공유·CPD0·risk-producer 리팩터)·`produceDecomposition`/`produceAdvisory`가 circuit 구성→StageDeps에 실어 픽업·**러너·risk·decompose·advisory가 같은 breaker 인스턴스 공유→워크플로(sessionId) 비용 통합 누적**·open/예산초과→스테이지 `fallback()` graceful degrade·신규 flag 0(기존 `MANAGER_BUDGET_*`/`MANAGER_PROVIDER_CIRCUIT` 게이트)·migration 0·off→회귀 0·#325)·**P5-3a 강등 모드 FSM 추적(observe-only)**(OPERATIONS_DECISIONS §1 NORMAL/DEGRADED/SAFE 운영 모드를 신호 구동 FSM으로 추적 — shared 순수 코어 `operational-mode.ts`(`desiredMode`/`nextMode`·악화 즉시·호전 히스테리시스 1단계/윈도·플래핑 방지)를 `streams/mode-controller.ts` `ModeController`(IntervalSweeper·never-throw)가 주기 tick으로 구동·신호원 `providerCircuit.snapshot().state==='open'`(→DEGRADED)·`budget.dailyTripped()`(→SAFE)·전이 시 구조적 `app.log.warn`(M8 비-무음)·`getMode()` 노출·**enforcement 0**(SAFE 디스패치 보류·DEGRADED 사인오프는 P5-3b 후속)·`MANAGER_DEGRADED_MODE` flag+`MANAGER_MODE_SWEEP_MS`/`STABILITY_WINDOW_MS` env·migration 0·이벤트 0·off→회귀 0·#327)·**P5-3b 강등 enforcement(SAFE 디스패치 보류+복구 재개)**(P5-3a `getMode()`를 첫 실제 게이팅 연결 — 모드 SAFE면 `handleDispatch`(decomposition·completion·oracle 공유 단일 chokepoint)가 신규 디스패치 보류(`status:'held'`·`onHeld`로 in-memory held-set 기록·recordDispatch/publish 미실행·WP는 DRAFTED 유지)→`ModeController`가 SAFE 이탈 전이(`from==='SAFE'`) 감지→`onRecover`→`Supervisor.resumeDispatch`→`drainHeld`(per-item never-throw)로 held-set 드레인 재디스패치(이미 모드≠SAFE→정상)·DEGRADED는 디스패치 무영향(N2 사인오프 별도)·`buildDispatchGate`로 getMode↔held↔resume 글루 추출(단위 커버)·`shouldEnforceDegraded` 순수 게이트·SAFE=budget 일 상한 트립 유일 신호라 UTC 일 롤오버 시 자동 복구(데드락 없음)·`MANAGER_DEGRADED_ENFORCE` flag(전제 MANAGER_DEGRADED_MODE+TASK_MANAGER_ENABLED)·shared 변경 0·migration 0·이벤트 0·off→P5-3a observe-only 바이트 동일 회귀 0·#329)·**N2 DEGRADED HIGH-risk 디스패치 사인오프**(P5-3 enforcement 둘째 동작 — 운영 모드 DEGRADED에서 HIGH-risk WP를 자동 디스패치하지 않고 사람 사인오프 요구: `handleDispatch` per-WP 게이트(`getMode()==='DEGRADED'`∧`wp.risk==='HIGH'`∧미승인→보류+`degraded_dispatch` DecisionRequest 생성·멱등 `{wf}:degraded:{wpId}`·`onDegradedHighRisk`)→사람 `accept_known`→decision-consumer `recordSignOff`(scope='degraded_dispatch'·비부인 M9)+`redispatch(wf)`→`handleDispatch` 재실행→`hasApprovedDegradedDispatch` 내구 조회로 승인 WP만 통과→DISPATCHED·`reject`=no-op(보류 유지·만료는 B1 TTL/재에스컬)·LOW/MED·NORMAL/SAFE 무관(SAFE 일괄보류는 #329)·승인 내구성(sign_offs append-only·재시작 생존·재디스패치 멱등)·`buildDegradedDispatchBrief`/`makeDegradedDispatchBrief` 표준 DecisionContext(C1 카드 재사용)·`shouldWireDegradedSignoff` 순수 게이트·`MANAGER_DEGRADED_SIGNOFF` flag(전제 MANAGER_DEGRADED_ENFORCE(getMode)+MANAGER_DECISION_ROUTING+DATABASE_URL)·shared 변경 0·migration 0(`degraded_dispatch` type TEXT enum 확장)·이벤트 0·off→P5-3b 바이트 동일 회귀 0·**mode-recovery auto-resume 없음(B1 TTL 의존)**·#331)·**G2 인바운드 DLQ 격리**(손으로 짠 인바운드 3개 소비자 StreamConsumer·WatcherEventConsumer·SessionGatewayConsumer 정문 poison(invalid_schema)/핸들러 throw(handler_failed)를 `{stream}:dlq` 격리 — 내부 BaseConsumer DLQ와 동등·shared `routeToDlq` 쓰기 단일출처·재시도없음(비멱등)·무조건(flag0)·구조적/non-uuid/non-file_changed는 ack-skip·redrive 재사용·#335)·**C3 오라클 승인 UI(C1 결정 대기함 재사용)**(P3-2가 자동 생성하던 draft GWT 오라클을 사람이 승인할 **첫 UI 표면** — 그전엔 `PATCH /oracles/:id/approve`(서비스토큰·비부인 없음)뿐이고 `oracle_approval` DecisionRequest는 enum에만·생산자 0이라 DoR/conformance/impact/property 검증 체인이 UI 없는 승인에 묶임: 분해가 draft 오라클 영속 시 per-workflow `oracle_approval` DecisionRequest 발행(`streams/oracle-brief.ts` `buildOracleBrief`·requestId `{wf}:oracle` 멱등·risk-brief 미러·표준 DecisionContext)→C1 DecisionsPanel **타입-무관 surface**→사람 approve(JWT `decidedBy` 비부인)→decision-consumer approve 분기가 `OracleRepo.approvePendingByWorkflow`(그 workflow pending 오라클 전부 `drafted→human_approved`+`oracle.approved` × N)→재디스패치(P3-1)→`oracleSatisfiedSet`→DoR 충족·**기존 risk_classification approve 경로 보존**·생산자=decomposition-consumer(`decisionStore` 주입·best-effort never-throw)·소비자=DecisionRecordedConsumer(`oracleStore` 주입)·`shouldWireOracleDecision` 순수 게이트·`createRequest` ON CONFLICT 멱등(재분해 원 요청 보존)·**dispatch-unlock 전체 폐합은 `MANAGER_ORACLE_DOR`도 필요**(P3-1 분리·C3는 승인까지)·`MANAGER_ORACLE_DECISION` flag(전제 `MANAGER_ORACLE_DRAFT`+`MANAGER_DECISION_ROUTING`+`DATABASE_URL`)·**Orchestrator/UI 변경 0**(C1 재사용)·shared 변경 0·migration 0·이벤트 0·off→회귀 0·#341)·**F5 invariant 초안 생성기(property 채널 입력원 활성)**(P3-2가 scenarios만 생성하고 P4 property 채널이 소비할 invariants를 생성·승인할 경로가 없어 구조적 휴면이던 단층 닫음 — `draft-invariants.ts` 스테이지가 story별 도메인 불변식(`{statement,domain,property}`) 초안 LLM 생성→`OracleDraft.invariants` 부착(additive·draftOracles는 `invariants:[]` 정합)→pipeline `invariantsEnabled` 머지→producer 스레딩→consumer `upsertDraft` 영속→**`OracleRepo.approve`가 scenarios와 동형으로 invariant draft `drafted→human_approved` 전이**(의도적 동작 변경·기존 oracle-invariants 통합테스트를 새 계약으로 재작성)→`approvedInvariantsForStory`→property 채널 활성·**stub 강제 안 함**(LLM이 진짜 불변식 못 찾으면 빈·graceful skip)·`MAX_INVARIANTS_PER_STORY`(6)·never-throw·**golden은 범위 외**(LLM fabricate 불가·N7·record-and-freeze 후속)·`MANAGER_ORACLE_INVARIANTS` flag(전제 `MANAGER_ORACLE_DRAFT`·실효성엔 `MANAGER_WP_PROPERTY`)·shared 변경 0·migration 0·off→회귀 0)·**golden freeze 사인오프(impact 채널 N7 강제·Slice 1)**(impact 채널이 frozen 여부 무관하게 golden을 소비하던 **잠재 N7 구멍**+golden freeze 경로 부재를 닫음 — `approvedGoldensForStory`가 `frozenBy!=null`(사람 사인오프) golden만 반환(N7 무조건)·`OracleGolden.frozenBy`=draft/frozen 상태(migration 0)·`freezeGoldensByWorkflow`(read-modify-write·멱등·이벤트 0·P2r-4 패턴)·`freezeUnfrozen` 순수코어·`unfrozenGoldenCount`(트리거 가드)·`golden_diff` DecisionRequest(`buildGoldenBrief`·C3 oracle-brief 미러·`{wf}:golden` 멱등)·생산자=워커 `maybeRequestGoldenSignoff`(develop_code verdict.ok 후·**에이전트 호출 0**·maybeProduceAdvisory 미러·best-effort)·소비자=decision-consumer approve `golden_diff`→freeze(JWT 비부인·기존 risk/oracle 분기 보존)·`shouldWireGoldenSignoff` 순수 게이트·golden 초안은 사람 `POST /oracles` 시드(**자동 캡처는 Slice 2**·Developer result 스키마 확장 교차서비스)·`MANAGER_GOLDEN_SIGNOFF` flag(전제 `MANAGER_WP_IMPACT`+`MANAGER_DECISION_ROUTING`+`MANAGER_TASK_WORKER`+`DATABASE_URL`)·**Orchestrator/UI 변경 0**(C1 재사용)·shared 변경 0·migration 0·off→회귀 0)·**G8 lease 가시성 auto-tune**(활성 검증 채널 기반 바닥값(verify/security 360s·heavy 600s)을 `resolveLeaseVisibilityMs`가 계산해 configured가 낮으면 기동 시 자동 상향(올리기만·bump 로그)—채널별 하한 경고 4개 대체·운영자 수동 상향 불필요·false reclaim 방지·#452)·**G9 프리미엄 프로필 아크 E2E**(autonomous 프로필이 build→WP→verify→완료 아크를 폐합함을 증명: Slice A(in-process·제로 flake·turborepo pg 잡·#453)가 로직을, Slice C(`createSupervisor` 실 조립·decomposition.emitted 시드·전용 `manager-redis-integration` 잡·#454)가 실 Redis 소비자 배선을 증명—"미배선" 리스크 봉인); github-ops·deploy-project ToolHandler; WatcherEventConsumer | [CLAUDE.md](xzawedManager/CLAUDE.md) |
| xzawedShared | — | ✅ 282/282 | 에이전트 서비스 공통 BaseConsumer(**바운드 재시도+DLQ 격리·멱등 소비 dedup·전송은 EventBus 위임**) + **DLQ 계약·재처리**(`dlq.ts` — `dlqStreamKey`·`idemKey`·`defaultDedupKey`·`DlqMessageSchema` 단일출처를 BaseConsumer가 재사용 + `redriveDlq` 운영 도구: 격리 메시지를 멱등 마커 선삭제 후 원 스트림 재발행) + **EventBus 전송 추상화(RedisEventBus: 발행+소비 포트)** + validateWorkspaceRoot + resolveWorkspaceRoot + SessionDispatcher + 협업 헬퍼 + 도메인 위키 주입 포매터 + **WorkPackage §7 계약 스키마**(risk(LOW/MED/HIGH)·inputs·outputs·epicId additive + 고정 attributionCounters{impl,task,plan} — content-hash id 정체성 제외(N4 안정)·레거시 backward-compat·P4c 진동차단(N5)·θ_risk 게이트 입력 토대) + **§13 서킷브레이커**(`budget/`: `costOf`(usage→USD·캐시 가중)·`BudgetCircuitBreaker`(워크플로/일 누적 상한·`check` fail-closed·인메모리·일 롤오버)·`BudgetExceededError` / `resilience/`: `ProviderCircuitBreaker`(provider 지속 장애 closed→open→half_open 상태머신·`before` fail-fast·cooldown probe·`onFailure`/`onSuccess`·provider-agnostic)·`ProviderCircuitOpenError`·`Bulkhead`(에이전트 종류별 풀+전역 캡·캡 도달 시 FIFO 큐잉(백프레셔·드롭 없음)·HoL 회피·`acquire`/`run`)·**`operational-mode`(P5-3a 운영 강등 모드 FSM 순수 코어 — `desiredMode`/`nextMode`·악화 즉시·호전 히스테리시스·NORMAL/DEGRADED/SAFE)**, 병렬-비용/장애/동시성 폭발 보호 순수 코어 + `BudgetCircuitBreaker.dailyTripped()`(SAFE 신호 조회)) + **P2-1 결정론 분해 코어**(coverageMatrix·contentHashId·mergeKeepInflight 순수 함수, senario §6 경계) + **P3-1 oracleSatisfiedSet**(§8 DoR satisfied-set 순수 코어) + **P2r-1 리스크 분류 결정론 코어**(`risk/` — Wiki Agent 분류기 §20.2의 P4·P5 순수 경계: `confidenceFromSupport`·`aggregateDimension`(noisy-OR)·`combineRisk`·`routeModels`(§5)·`evaluateHumanGate`(§4)·`scoreClassification`(verified claim→RiskClassification 아티팩트), LLM/IO 0·θ_risk 게이트 토대) + **`callClaudeTextWithUsage`**(Claude 호출 텍스트+usage 노출 — P2r-3 budget 서킷 `record` 입력·`callClaudeText`는 위임으로 회귀 0) 라이브러리 (@xzawed/agent-streams) | [CLAUDE.md](xzawedShared/CLAUDE.md) |
| xzawedPlanner | 3002 | ✅ 47/47 | intent → 실행 가능한 Step[] 분해; AgentQuery 교차질의 발생·응답 | [CLAUDE.md](xzawedPlanner/CLAUDE.md) |
| xzawedDeveloper | 3003 | ✅ 63/63 | 코드 생성·수정, 파일 I/O; **D5 모델 라우팅 소비**(`generateChanges(model?)`=`model ?? this.model`·`payload.model` 스레딩 — Manager 워커가 주입한 WP별 모델 id로 호출, 미주입 시 `CLAUDE_MODEL` 폴백·`payload.model`은 `collaborationPayloadFields`의 `model?: z.string()`로 보존·합성 스키마 회귀 가드 #333) | [CLAUDE.md](xzawedDeveloper/CLAUDE.md) |
| xzawedDesigner | 3004 | ✅ 42/42 | UI 컴포넌트 스펙 설계 | [CLAUDE.md](xzawedDesigner/CLAUDE.md) |
| xzawedTester | 3005 | ✅ 65/65 | 테스트 실행·분석; AgentQuery 응답; 도메인 지식 emit | [CLAUDE.md](xzawedTester/CLAUDE.md) |
| xzawedBuilder | 3006 | ✅ 70/70 | 프로젝트 빌드 감지·실행; AgentQuery 응답; 도메인 지식 emit | [CLAUDE.md](xzawedBuilder/CLAUDE.md) |
| xzawedWatcher | 3007 | ✅ 51/51 | 파일 변경 감시·이벤트 스트리밍(실-FS chokidar 통합 테스트로 glob 감시 회귀 가드) | [CLAUDE.md](xzawedWatcher/CLAUDE.md) |
| xzawedSecurity | 3008 | ✅ 114/114 | OWASP 보안 감사; AgentQuery 응답·SecurityIssue source 태그(static/deps/llm — Manager security 채널 결정론 판별) | [CLAUDE.md](xzawedSecurity/CLAUDE.md) |
| xzawedLauncher | — | ✅ 20/20 | 비개발자 대상 설치·실행 런처(Docker Compose 전체 서비스 자동 관리·Claude 인증·시스템 트레이 모니터링); Electron + React 19, Turborepo | [CLAUDE.md](xzawedLauncher/CLAUDE.md) |

## 비전 3대 축 아키텍처

PR #186~#208에서 구축된 "유기적 협업 에이전트 조직" 비전의 3대 축. 설계 스펙은 [`docs/superpowers/specs/`](docs/superpowers/specs/2026-06-01-platform-vision.md) 참고.

### (a) 협업 — AgentQuery 교차질의

에이전트가 단계 수행 중 다른 에이전트의 판단이 필요하면 직접 import 없이 **Manager를 경유해 교차질의**한다. planner가 질의를 발생시키고(`AgentQuery`), tester·builder·security가 답변자로 응답한다.

- **공통 헬퍼**: `xzawedShared/src/streams/collaboration.ts` — `runCollaborativeHandle`·`createCollaborativeHandler` 팩토리로 7개 에이전트의 handle 골격(abort·query 모드·정상 경로·error 발행)을 공유. 질의 발생은 `publishAgentQuery`를 제공한 에이전트만 지원.
- **라우팅**: `xzawedManager runner.ts`의 `processToolUseBlocks`가 `AgentQueryError`를 catch → `resolveAgentTool(err.to)`로 대상 도구 해석 → 대상 핸들러를 `buildAgentQueryPayload(err)`로 실행 → 응답을 `clarificationContext`로 원 에이전트 재실행. 페이로드는 전 답변자 스키마 **필수 필드 합집합**을 placeholder로 채워(`query`·`context` 외는 검증 통과 전용·질의 모드 미사용) 어느 답변자로 라우팅돼도 DLQ/타임아웃을 막는다. **watcher는 답변 불가라 대상에서 제외**(`AGENT_TO_TOOL` 미포함 → 즉시 `is_error`).

### (b) 승인 게이트 — Human-in-the-loop

에이전트 디스패치 결과를 PO(사용자)가 승인/수정/중단하는 코드 강제 게이트.

- **순수 모듈**: `xzawedManager gates/approval-gate.ts` — `effectiveMode`(override·default 해석)·`isGatedTool`·`parseDecision(answer, failSafe=true)`(approve/revise/abort + **fail-safe**: 파싱 불가·비객체·미지 decision은 `needs_human`으로 에스컬레이션, `failSafe=false`면 레거시 approve fail-open)·`GATED_TOOLS`·`DEPLOY_TOOLS`(deploy_project는 **항상 manual**, auto override 무시)·`KNOWLEDGE_BEARING_STAGES`(plan/design/develop/security).
- **runner 훅**: `applyApprovalGate` 루프 — manual이면 `info_request`(payload.approval) 발행 후 대기 → approve(`rememberAuto`면 이후 단계 자동 승인, `saveToWiki`면 결정 요약 위키 저장)·revise(피드백으로 재실행, `MAX_GATE_REVISES` 상한)·abort(`GateAbortError`)·**needs_human**(자동 승인 금지·사유와 함께 사람 재요청, `MAX_GATE_REASKS` 초과 시 에스컬레이션). **fail-safe(`MANAGER_GATE_FAILSAFE`, 기본 true)**: revise 소진도 무음 통과 대신 에스컬레이션. senario M8(무음 통과 금지)·N1(불확실=실패).
- **승인 UI**: Orchestrator `ChatView.tsx` 승인 카드 + `POST /sessions/:id/ui-actions`(결정 → `info_response` 발행) + `lib/api.ts` `postUiAction`. **데모 시연(P4)**: design_ui 승인 시 Manager가 `buildDemoSpec`으로 결과 UISpec(components+content)을 `info_request.payload.uiSpec`에 첨부 → `UiSpecPreview`(Spec 인터프리터, `chat/uispec/registry.tsx` ~15종 styled 렌더러 + 폴백, 읽기전용·HTML 주입 없음)가 카드에 정적 목업 렌더.

### (c) 도메인 위키 — 프로젝트 지식 누적

에이전트가 산출한 도메인 지식을 프로젝트 단위로 누적하고 후속 단계에 주입한다.

- **저장소**: `xzawedManager db/knowledge.repo.ts` `KnowledgeRepo` — `domain_knowledge` 테이블(content·source_agent·category). `recentByProject`(query ILIKE·sourceAgent·category 필터)·`insertMany`·`updateById`·`deleteById`(project_id 가드).
- **runner 통합**: `injectDomainKnowledge`(도구 호출 전 최근 N건을 `context.domainKnowledge`로 주입)·`storeDomainKnowledge`(게이트 통과 결과의 `knowledge[]` 누적)·`saveApprovedDecision`(승인 결정을 `category:'decision'`로 저장, 지식성 단계 한정). 생성형 에이전트는 `xzawedShared prompt/domain-knowledge.ts` `formatDomainKnowledge`로 주입된 지식을 프롬프트에 반영.
- **위키 UI**: Manager `api/knowledge.route.ts`(GET/PATCH/DELETE, 비인증) → Orchestrator `api/knowledge.route.ts` 프록시 → `WikiPanel.tsx`(검색·출처/분류 필터·category 배지·인라인 편집·삭제).

## 공통 기술 스택

TypeScript 5 (strict mode) 공통 적용. 모든 서비스가 사용:

- **Fastify 5** — HTTP 서버 (`/health` 엔드포인트)
- **ioredis** — Redis Streams 소비자/생산자
- **Zod** — 환경변수 검증 및 스키마
- **@anthropic-ai/sdk** — Claude API 호출
- **Vitest 3** — 테스트 (`pool: 'forks'`, 프로세스 격리; Turborepo 패키지는 기본 설정 사용)
- **pnpm** — 패키지 매니저 (npm/yarn 사용 금지)

xzawedOrchestrator 추가: **@modelcontextprotocol/sdk** (MCP 서버), **React 19 + Zustand + Electron** (데스크톱 UI), **Turborepo** (xzawedOrchestrator·xzawedManager 모노레포), **@octokit/rest** (xzawedManager GitHub API).

xzawedOrchestrator Electron 앱 추가: GitHub OAuth 통합, McpProcessManager (child_process.spawn), PluginManager (Claude Code / xzawed 확장 관리), Zustand integrations.store, **Tailwind CSS v4** (디자인 토큰), **shadcn/ui** (Button·Badge·Dialog·Command 등), **Framer Motion** (UI 애니메이션), **Shiki** (코드 하이라이팅), **cmdk** (⌘K Command Palette), **sonner** (토스트). **i18next 26** + **react-i18next 17** — 한국어·영어·일본어 i18n. 문자열 추가 시 `locales/ko/app.json`에 키 추가 후 `en/ja` 동기화 필수. 서버는 `packages/server/src/i18n/server-i18n.ts` + Accept-Language 파싱.

## 테스트 패턴

### 블로킹 I/O Mock

Redis `XREADGROUP BLOCK` 등 블로킹 I/O를 mock할 때 즉시 resolve하면 macrotask 큐가 차단되어 OOM이 발생한다.
반드시 `setImmediate`로 macrotask 양보를 재현한다.

```typescript
// ❌ 마이크로태스크 루프 유발 — setTimeout이 실행되지 않아 stop()이 호출 불가
xreadgroup: vi.fn().mockResolvedValue(null)

// ✅ 올바른 패턴 — macrotask로 이벤트 루프 양보
xreadgroup: vi.fn().mockImplementation(
  () => new Promise<null>(r => setImmediate(() => r(null)))
)
```

### ioredis 테스트 환경 설정

Redis가 없는 테스트 환경에서 ioredis의 기본 무한 재연결이 이벤트 루프를 활성 상태로 유지한다.
모든 redis.client.ts에 적용:

```typescript
client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 2000,
  retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined,
})
```

### vitest Shard Coverage 병합

vitest 3.x에 `merge-coverage` 서브커맨드가 없다. shard별 `lcov.info`를 직접 병합한다:

```bash
# CI에서 shard 1/2, 2/2 실행 후
mkdir -p coverage
cat coverage/shard-*/lcov.info > coverage/lcov.info
```

### E2E 선택자 규칙 (i18n 환경)

i18n 적용 후 텍스트 기반 선택자는 로케일 변경 시 깨진다. **`data-testid` 전용 사용 필수**.

```typescript
// ❌ 로케일 변경 시 깨짐
await page.getByText('설정 저장').click()

// ✅ 로케일 무관
await page.getByTestId('settings-save').click()
```

Page Object Model(POM): `packages/app/e2e/pages/` 참고.

### E2E Electron 한계 및 대응 패턴

Playwright E2E에서 Electron 특유의 제약이 있다. 확인된 패턴:

**IPC mock — `electronApp.evaluate()` 금지**: nav 클릭 등 UI 인터랙션 이후 `electronApp.evaluate()`로 ipcMain 핸들러를 교체하면 Electron 내부 nav 이벤트 큐가 블로킹되는 부작용이 있다. 대신 test 모드에서 `main.tsx`가 `window.__integrationsStore`를 노출하므로 `page.evaluate()`로 직접 상태를 주입한다:
```typescript
// ❌ electronApp.evaluate() — nav 클릭 후 블로킹 부작용 발생
await electronApp.evaluate(({ ipcMain }) => {
  ipcMain.removeHandler('github:get-status')
  ipcMain.handle('github:get-status', () => ({ connected: true, username: 'test' }))
})

// ✅ window.__integrationsStore 직접 주입 (test 모드 전용)
await page.evaluate(() => {
  window.__integrationsStore?.setState({ github: { connected: true, username: 'test' } })
})
```

**locale 선주입 (CI 대응)**: `page.reload()` 전에 `page.addInitScript()`로 localStorage에 locale을 선주입해야 CI에서 로케일이 초기화 타이밍 문제로 어긋나지 않는다:
```typescript
await page.addInitScript(() => {
  localStorage.setItem('locale', 'en')
})
await page.reload()
await page.waitForSelector('[data-i18n-ready]')
```

**i18n 초기화 완료 대기**: `page.reload()` 후 i18n이 재초기화될 때까지 대기 필요:
```typescript
await page.reload()
await page.waitForSelector('[data-i18n-ready]') // i18n.ts init 완료 시 설정되는 속성
```

**WebSocket mock 불가**: `page.route()`는 HTTP만 intercept하며 `ws://` 차단 불가. 에러 상태 시뮬레이션은 HTTP 엔드포인트 mock으로 대체:
```typescript
// ❌ ws:// 차단 불가
await page.route('**/ws/**', route => route.abort())

// ✅ HTTP 오류로 에러 경로 테스트
await page.route('**/sessions/*/messages', route => route.fulfill({ status: 500 }))
```

**MemoryRouter + reload**: Electron 앱은 BrowserRouter 대신 MemoryRouter를 사용해 `page.waitForURL()`이 동작하지 않음. DOM testid나 `waitFor({ state: 'visible' })`로 네비게이션 완료 확인:
```typescript
await element.waitFor({ state: 'visible', timeout: 10_000 })
```

**i18n 대기 — `waitForI18n` fixture 사용**: `fixtures.ts`의 `waitForI18n` fixture로 `[data-i18n-ready]` 대기를 추상화:
```typescript
// ❌ 중복
await page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 })

// ✅ fixture 사용
test('...', async ({ page, waitForI18n }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'))
  await page.reload()
  await waitForI18n()
})
```

**POM 클래스 패턴**: `PluginPanel`·`SettingsModal` 모두 `open()`/`close()` 메서드를 제공한다. 새 패널 POM 추가 시 동일 패턴 적용:
```typescript
async open(): Promise<void> {
  await this.navButton.click()
  await this.panel.waitFor({ state: 'visible' })
}
```

## 공통 명령어 패턴

### Turborepo 기반 (xzawedOrchestrator, xzawedManager)

```bash
pnpm install
pnpm build                              # 전체 빌드
pnpm test                               # 전체 테스트
cd packages/server && pnpm dev          # 서버 개발 모드
cd packages/server && pnpm test <파일>  # 단일 테스트 파일
```

### 독립 서비스 (그 외 모든 에이전트)

> **⚠️ 사전 빌드 필수**: 독립 에이전트 서비스 테스트 실행 전 xzawedShared를 먼저 빌드해야 한다.
> ```bash
> cd xzawedShared && pnpm install && pnpm build && cd ..
> ```
>
> **♻️ shared 편집 후 복사본 새로고침**: 독립 서비스는 `@xzawed/agent-streams`를 `file:../xzawedShared`로 참조하며, `file:` dep은 install 시점에 node_modules로 **복사**된다. xzawedShared를 로컬에서 재빌드해도 이 복사본은 다음 install까지 **stale**로 남아 신규 파일 누락 등 혼란을 준다(CI·Docker는 매번 fresh install이라 무관). shared 편집 후 아래 한 번으로 빌드 + 7개 서비스 복사본을 일괄 새로고침한다(`pnpm install --frozen-lockfile`이 복사본만 갱신·lockfile 무오염):
> ```bash
> bash scripts/sync-shared.sh
> ```

```bash
pnpm install
pnpm dev               # tsx watch 개발 모드
pnpm test              # Vitest 전체 실행
pnpm test <파일>       # 단일 테스트 파일
pnpm build             # TypeScript 컴파일 → dist/
```

## Redis Streams 통신 구조

스트림 키 규칙:

```
{출발지}:to-{목적지}:{sessionId}   →   소비자 그룹: {목적지}-consumers
```

실제 예: `orchestrator:to-manager:{sessionId}`, `manager:to-planner:{sessionId}`, `{agent}:to-manager:{sessionId}` 등. 모든 에이전트는 `manager:to-{agent}:{sessionId}` 수신 → `{agent}:to-manager:{sessionId}` 응답 패턴을 따른다.

모든 메시지 공통 구조:

```typescript
{
  sessionId: string
  messageId: string
  timestamp: number
  type: string      // 서비스별 정의
  payload: object   // 서비스별 정의
}
```

## 공통 환경 변수

모든 서비스의 `.env.example`을 `.env`로 복사 후 실행.

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<서비스별 포트>
MODE=local
```

> **예외**: xzawedWatcher는 Claude API를 사용하지 않으므로 ANTHROPIC_API_KEY / CLAUDE_MODEL 불필요.

서비스별 추가 환경 변수, 메시지 인터페이스, 아키텍처 세부 사항은 각 서비스 디렉토리의 `CLAUDE.md`를 참고한다.

## 개발 워크플로우

**모든 작업은 Pull Request(PR)를 통해 진행한다.**

```
feature/fix 브랜치 생성 → 작업 → 테스트 통과 → 코드 검토 → PR 생성 → 머지
```

### Git Hooks 설치 (클론 후 1회)

```bash
bash scripts/install-hooks.sh
```

- **pre-commit**: 변경된 서비스만 tsc 타입 체크 (commit 시 자동)
- **pre-push**: jscpd CPD + pnpm audit (push 시 자동)
- 긴급 우회: `git commit --no-verify` (CI에서는 여전히 검사됨)

### Claude Code 스킬 (`.claude/commands/`)

- `/pr-ready` — PR 생성 전 7단계 자동 체크 (빌드·테스트·audit·CPD·E2E선택자·i18n·Dockerfile)
- `/e2e-electron` — E2E 스펙 금지 패턴 자동 감지 및 수정 가이드
- `/i18n-add <ns.key> <ko-text>` — ko/en/ja 3개 파일 동시 i18n 키 추가
- `/sonar-check` — SonarCloud 품질 게이트 로컬 사전 검증
- `/contract-drift-check` — 여러 파일에 복제된 계약 정의(타입 유니언·스키마 필드·IPC 채널) 드리프트 읽기전용 진단 (tsc 사각지대)
- `/dev-path-guard-audit` — Developer·Builder·Tester 경로/명령 실행 보안 불변식 읽기전용 정적 감사

### 규칙

1. `master`에 직접 push 금지 — 반드시 브랜치를 만들어 작업한다
   > master 직접 커밋 시 SonarCloud "New Code" 계산 기준이 꼬여 소급 PR로도 CPD 통과가 어려워진다
2. PR은 작업 완료 후 마지막에 생성한다 (Draft PR 방식 사용 금지)
3. PR 생성 전 필수 조건 (`/pr-ready` 스킬로 자동화):
   - 해당 서비스의 테스트 전체 통과 (`pnpm test`)
   - **빌드 성공 (`pnpm build`) — tsc 타입 체크 포함, 테스트 파일도 검사**
   - `pnpm audit` 취약점 0개
   - CPD 로컬 확인: `npx jscpd@3.5.10 --config .jscpd.json` (0 clones 목표)
   - i18n 키 동기화: `node scripts/check-i18n.js` (ko/en/ja 일치 확인)

### 장기 디버깅 시 컨텍스트 관리

같은 실패를 3회 이상 반복할 경우, 계속 진행하기 전에 다음을 먼저 정리한다:

```
시도한 것: [목록]
각 시도가 실패한 이유: [목록]
아직 확인하지 못한 가설: [목록]
```

이 요약 없이 계속하면 이미 실패한 접근법을 반복하게 된다. CI 로그·대시보드·외부 도구(jscpd 리포트, SonarCloud API 댓글)의 실제 출력을 코드 추론보다 우선한다.

### 브랜치 네이밍

```
feat/<서비스>/<설명>   # 새 기능
fix/<서비스>/<설명>    # 버그 수정
docs/<설명>            # 문서만 변경
chore/<설명>           # 의존성, 설정 변경
```

예: `feat/developer/file-diff-support`, `fix/security/static-analyzer-false-positive`

## 보안 아키텍처 원칙

PR #9(2026-05-17) 전체 보안 감사를 통해 수립된 공통 보안 패턴.

### 명령 실행 (Builder, Tester)
- `spawn(cmd, [], {shell:true})` **금지** — 반드시 `spawn(bin, args, {shell:false})` 사용
- Redis 페이로드의 커맨드 필드는 allowlist 검증 필수 (`ALLOWED_PREFIXES`)
- `package.json scripts` 값은 신뢰하지 않음 — 의존성 기반 하드코딩 명령어만 사용

### Redis 메시지 검증
- 모든 Redis 수신 메시지는 `safeParse`(Zod) 로 런타임 검증 후 처리
- 검증 실패 시 `xack` 후 skip (프로세스 중단 금지)

### 경로 검증
- `WORKSPACE_ROOT`가 파일시스템 루트(`/`, `C:\`)이면 시작 시 거부 — `validateWorkspaceRoot(workspaceRoot)` (from `@xzawed/agent-streams`) 호출로 통일
- LLM 생성 경로는 절대경로 허용 금지 — `workspaceRoot` 기준 상대경로로 강제
- `triggers` 등 외부 입력 glob은 절대경로·`..` 포함 시 Zod 단계에서 차단

### 인증
- `SERVICE_JWT_SECRET`은 `AUTH=jwt` 시 32자 이상 필수 (`superRefine` 강제)
- OAuth 플로우에는 반드시 `state` 파라미터 생성·검증 (CSRF 방지)

### Electron IPC
- 민감 자격증명(토큰, 키)은 렌더러에 노출 금지 — main 프로세스에서 직접 API 호출
- MCP `args`는 런타임별 위험 플래그(`-e`, `-c`, `--eval`, URL) 차단
- `electron.d.ts`에 `Window` 인터페이스 + `var electronAPI` 전역 선언 모두 필요 — 렌더러 컴포넌트가 `globalThis.electronAPI`로 접근 시 타입 추론을 위해 (`interface Window`만으로는 `typeof globalThis` 인덱스 미반영)

### SSRF / Open Redirect 방지
- `fetch` URL은 반드시 `new URL(url)` 파싱 후 `protocol`이 `http:` 또는 `https:`임을 검증 (http-remote-runner.ts, manager.client.ts)
- `shell.openExternal` 호출 전 URL 접두사 검증 필수 — 예상 접두사가 아니면 즉시 에러 (github-oauth-handler.ts)

### Redis 안정성
- `handler(msg)` 호출은 반드시 `try/finally`로 감싸 `xack` 보장 — 핸들러 예외 시 PEL 누수 방지
- `JSON.parse` + `onMessage` 모두 `try/catch/finally`로 감싸 메시지 처리 실패 시에도 `xack` 실행

### Dockerfile 보안 (SonarCloud 규칙 준수)
새 Dockerfile 작성 또는 기존 Dockerfile 수정 시 아래 항목을 반드시 확인한다.

- **`docker:S6501` — runner 스테이지에 `USER node` 필수**: 컨테이너가 root로 실행되면 SonarCloud가 Security Hotspot으로 탐지. `EXPOSE` 다음 줄, `CMD` 바로 앞에 추가.
  ```dockerfile
  EXPOSE 3XXX
  USER node
  CMD ["node", "dist/index.js"]
  ```
- **`docker:S6505` — `pnpm install`에 `--ignore-scripts` 필수**: 모든 `RUN pnpm install` 명령에 `--ignore-scripts` 포함. 순수 JS 의존성만 사용하는 한 동작에 영향 없음.
  ```dockerfile
  RUN pnpm install --frozen-lockfile --ignore-scripts
  ```
- **Dockerfile을 완전 재작성하면 모든 줄이 "신규 코드"**: SonarCloud PR 분석은 PR diff의 추가·변경된 줄만 신규 코드로 계산. Dockerfile 전체를 재작성한 경우 위 두 규칙 위반이 모두 신규 핫스팟으로 탐지됨.

### 전이 의존성 취약점 (pnpm overrides)
직접 의존성이 아닌 전이 의존성 취약점은 `pnpm audit`이 잡지만 `pnpm update`로 해결되지 않는다.
루트 `package.json`에 `pnpm.overrides`로 강제 해결:

```json
"pnpm": {
  "overrides": {
    "취약한-패키지": ">=안전한-버전"
  }
}
```

적용 후 `pnpm install` 실행으로 lock 파일 업데이트 필수.

### 브랜치 의존성 관리
같은 파일을 병렬 브랜치에서 수정하면 merge conflict가 발생한다.

- **순차 의존 관계**: 선행 PR 머지 확인 후 후행 브랜치 분기
- **병렬 작업 중 master 머지 발생 시**: 즉시 `git merge origin/master` 실행 후 충돌 해결
- **PR 설명에 명시**: "이 PR은 #N 머지 후 리뷰 요망" (의존 관계 있을 때)

## SonarCloud 트러블슈팅

상세 가이드: [docs/development/sonarcloud.md](docs/development/sonarcloud.md)

**빠른 참조**:
- CPD 실패 → `npx jscpd@3.5.10 --config .jscpd.json` 로컬 확인 먼저
- 핫스팟 규칙 ID 확인 → SonarCloud PR 댓글 링크 → Security Hotspots 탭
- Dockerfile → `USER node`(S6501), `--ignore-scripts`(S6505) 필수

## 인프라

- **Docker**: `docker-compose.yml` — Redis + 9개 서비스 전체 실행. 모든 서비스 `context: .` (프로젝트 루트) + `dockerfile: <서비스>/Dockerfile` 패턴. xzawedOrchestrator·xzawedManager는 각각 `Dockerfile.dockerignore`로 빌드 격리. planner·designer·developer·tester·builder·watcher·security에 `WORKSPACE_ROOT: /workspace` 주입, orchestrator에 `MANAGER_URL: http://manager:3001` 주입.
- **CI/CD**: `.github/workflows/ci.yml` — PR마다 9개 서비스 병렬 빌드·테스트·감사 자동 실행. `redis-integration` 잡(Redis 서비스 컨테이너), `playwright-e2e` 잡(Electron E2E, xvfb-run, 110개 스펙), `all-checks-pass` 게이트 포함. PR 전용으로 jscpd(중복 파일·줄 번호) + SonarCloud API 폴링(품질 게이트·파일별 밀도) 댓글 자동 게시.
- **Dependabot**: `.github/dependabot.yml` — 9개 서비스 + GitHub Actions 주간 의존성 업데이트.
