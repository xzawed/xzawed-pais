[홈](../README.md) > [개발](./contributing.md) > 로드맵

# xzawedPAIS 로드맵

프로젝트 전체 계획과 설계 스펙의 구현 현황을 추적한다.

---

## 완료됨

### 핵심 서비스 구현 (2026-05-15)

9개 에이전트 서비스 전체 초기 구현. Redis Streams 기반 비동기 통신, Docker 인프라, CI/CD 파이프라인 구축.

관련 문서: `docs/archive/specs/`, `docs/archive/plans/`

---

### GitHub · MCP · Plugin 통합 (PR ~#70 구간)

xzawedOrchestrator Electron 앱에 GitHub OAuth 연동, MCP 서버 관리, Plugin 관리 패널 추가.  
xzawedManager에 `github-ops` ToolHandler(Octokit 기반) 구현.

설계 스펙: [2026-05-17-github-mcp-plugin-integration-design.md](../superpowers/specs/2026-05-17-github-mcp-plugin-integration-design.md)  
구현 계획: [2026-05-17-github-mcp-plugin-integration.md](../superpowers/plans/2026-05-17-github-mcp-plugin-integration.md)

---

### JWT 인증 + 의도 정제 + 태스크 추적 (PR ~#70 구간)

xzawedManager JWT 에러 코드 분기 완성. xzawedOrchestrator `intent-structurer.ts` 신규 생성, `TaskStore` 태스크 생명주기 구현, `/sessions/:id/tasks` 엔드포인트 추가. 원격 실행기(`HTTPRemoteRunner`, `SSHRemoteRunner`) 구현.

구현 계획: [2026-05-17-issues-10-11-12-13.md](../superpowers/plans/2026-05-17-issues-10-11-12-13.md)

---

### UI/UX 리디자인 (PR ~#70 구간)

xzawedOrchestrator Electron 앱을 IDE 하이브리드 4패널 레이아웃으로 전면 재설계.  
ActivityBar + Sidebar + ChatView + RightPanel. Tailwind CSS v4, shadcn/ui, Framer Motion, Shiki 코드 하이라이팅, ⌘K Command Palette.

설계 스펙: [2026-05-18-xzawedpais-ui-redesign-design.md](../superpowers/specs/2026-05-18-xzawedpais-ui-redesign-design.md)  
구현 계획: [2026-05-18-xzawedpais-ui-redesign.md](../superpowers/plans/2026-05-18-xzawedpais-ui-redesign.md)

---

### ✅ xzawedLauncher — 비개발자 런처 GUI (구현 완료)

비개발자를 위한 독립 Electron 데스크탑 런처. Docker Compose 자동 관리, Claude 인증 마법사, 시스템 트레이 모니터링, GitHub Releases 자동 업데이트.

설계 스펙: [2026-05-19-xzawed-launcher-design.md](../superpowers/specs/2026-05-19-xzawed-launcher-design.md)  
서비스 문서: [docs/services/launcher.md](../services/launcher.md)

---

### ✅ Project Registry (PR #114 머지 완료)

외부 서비스(로컬 디렉토리 또는 GitHub 리포)를 등록하고 프로젝트별 워크스페이스 경로를 관리한다.  
Orchestrator Projects API, WorkspaceService, ProjectContextBar UI, `register_project`/`switch_project` 대화 도구.

설계 스펙: [2026-05-24-project-registry-design.md](../superpowers/specs/2026-05-24-project-registry-design.md)

---

### ✅ SKILL.md + Claude Hooks + 문서 구조 재편 (PR #118 머지 완료)

SKILL.md 계층 도입, Claude Code Hook 자동화 설정, `docs/` 디렉터리 구조 재편.  
`docs/concepts/`, `docs/services/`, `docs/reference/`, `docs/development/`, `docs/guides/` 체계 확립.

설계 스펙: [2026-05-25-skill-hooks-docs-design.md](../superpowers/specs/2026-05-25-skill-hooks-docs-design.md)

---

### ✅ 에이전트 복원력 + 커버리지 (PR #119 머지 완료)

Claude API 타임아웃(`MANAGER_CLAUDE_TIMEOUT_MS=120000`), Redis 단절 복구, xack try/finally 보장, 테스트 커버리지 확장.  
SonarCloud 품질 게이트 통과 기준 강화.

---

### ✅ Phase 1 — ADR-001 HTTP 위반 제거 (PR #121 머지 완료)

서비스 간 HTTP 직접 호출 제거. Manager → 하위 에이전트 통신을 Redis Streams 게이트웨이(`manager:to-{agent}:sessions`)로 전환. Project 정보는 Redis RPC 패턴으로 조회.

ADR: [docs/development/adr/](adr/README.md)

---

### ✅ Phase 3 — 퍼세션 서브에이전트 스트림 라우팅 (PR #122 머지 완료)

`SessionDispatcher`를 통한 세션별 동적 Consumer 생성. ADR-001 세션 격리 아키텍처 완성.  
`xzawedShared`의 `SessionDispatcher` 클래스, 각 에이전트 서비스 `session-dispatcher` 통합.

---

### ✅ CI OOM 회고 + ADR-002 + 테스트 패턴 (PR #123 머지 완료)

GitHub Actions OOM 방지 전략 정리. ADR-002 테스트 격리 패턴 문서화. `setImmediate` 기반 블로킹 I/O mock 패턴, ioredis Vitest 환경 설정 패턴 확립.

문서: [docs/development/testing-patterns.md](testing-patterns.md)

---

### ✅ i18n 다국어 지원 + Playwright E2E 포괄 커버리지 (feat/i18n-e2e-coverage)

한국어·영어·일본어 3개 언어 i18n(i18next 26 + react-i18next 17) 및 Playwright E2E 13개→~102개 구축.  
POM 패턴 + `data-testid` 전용 선택자. 서버 Accept-Language 파싱. 번역 기여 가이드 작성.

설계 스펙: [2026-05-27-i18n-e2e-coverage-design.md](../superpowers/specs/2026-05-27-i18n-e2e-coverage-design.md)

---

### ✅ 비전 3대 축 — 협업·승인 게이트·도메인 위키 (PR #186~#216 구간)

"유기적 협업 에이전트 조직" 비전의 3대 축 구축. (a) AgentQuery 교차질의(에이전트 간 Manager 경유 질의·응답), (b) 승인 게이트(Human-in-the-loop 코드 강제 게이트 + fail-safe, PR #242), (c) 도메인 위키(프로젝트 지식 누적·주입·뷰어 UI).

설계 스펙: [2026-06-01-platform-vision.md](../superpowers/specs/2026-06-01-platform-vision.md)

---

## senario 사양(v5) 자율 워크플로 로드맵 — Phase 진행 현황

PR #238에서 반영된 senario 사양(v5) 기반 자율 Task Manager 로드맵(P0~P6). 슬라이스 단위 PR로 진행하며, 구축된 파이프라인은 피처 플래그(기본 off) 뒤에 가역적으로 배선된다. 각 슬라이스의 설계 스펙은 `docs/superpowers/specs/`에 날짜-주제 형식으로 기록된다.

| Phase | 내용 | 상태 | 주요 PR |
|-------|------|------|---------|
| P0 | 세션 이벤트소싱 + 트랜잭셔널 아웃박스 (`EVENT_SOURCED_SESSION`) | ✅ 완료 | #243 |
| P1a~c | BaseConsumer 바운드 재시도+DLQ·멱등 소비(M6)·EventBus 전송 추상화 | ✅ 완료 | #244~#252 |
| P1d | Task Manager 1~7 — 그래프 코어·영속·소비·디스패치·lease/escalation·완료 흐름·Supervisor 배선 (`TASK_MANAGER_ENABLED`) | ✅ 완료 | #253~#262 |
| P2 | PM 다단계 분해 파이프라인 + 자가수선 (`MANAGER_DECOMPOSE_ENABLED`) | ◐ 부분 — P6 간선 추론(infer-edges·비순환)+P7 epicId 완료(#290) / inputs·outputs 채움·재진입 머지(merge_keep_inflight)·near_term 필터 잔여 | #263~#266, #290 |
| P2r | Wiki Agent 리스크 분류기 (5-슬라이스) | ✅ 코어~소비 완성 — P2r-1 결정론 코어(#286)+P2r-2 영속(migration 012)+**P2r-3 LLM 생산자**(decompose 시 4차원 단일 LLM 조사→인용검증→`scoreClassification`→upsert pending·`MANAGER_RISK_CLASSIFY`·#314)+**P2r-4 라우팅+wp.risk write-back**(사람 approve→`updateWpRisks`→mutation θ게이트 발화·`MANAGER_RISK_ROUTING`·#316)+**C5 승인 UI**(C1 결정 대기함 재사용·JWT 비부인·`MANAGER_RISK_DECISION`·#318)+**D5 §5 모델 라우팅 소비**(워커가 승인 modelRouting→`resolveWpModel`→develop_code 모델 주입·`MANAGER_MODEL_ROUTING`·#320) / 잔여: P7 per-WP 재채점·designer/tester/security 모델 소비 | #286, #289, #314, #316, #318, #320 |
| 횡단 | WP §7 계약 스키마 정합(S1) + §13 회복탄력성(budget·provider 서킷·벌크헤드) | ✅ 완료 | #282 / #283~#285 |
| P3 | Oracle DoR 게이트 + 초안 생성 (`MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT`) | ◐ 부분 — golden_refs/invariants는 P4 impact·property 채널에서 소비(완)·§14 step branch git 워크플로·WP 상태머신(8+2) 잔여 | #267~#268 |
| P4 | 실행 워커 + 실 검증 오라클 (`MANAGER_TASK_WORKER`·`MANAGER_WP_VERIFY`·`MANAGER_WP_CONFORMANCE`·`MANAGER_WP_ADVISORY`·`MANAGER_WP_IMPACT`·`MANAGER_WP_PROPERTY`·`MANAGER_WP_MUTATION`·`MANAGER_WP_SECURITY`) | ◐ 골격+컨텍스트(4a)+correctness 게이트(4b-1)+오라클 conformance(4b-2)+vacuous-pass `passed>0` floor·Oracle 스키마 invariants/golden_refs(4b-3·migration 010)+**advisory 채널(N3·비차단 큐·migration 013)**+**impact golden-differential(N8·N7·golden_refs 첫 소비)**+**property 채널(invariants·conformance 렌즈·boundary+명시 속성 단언·N7·데이터 주도 채널 루프 hard-AND)**+**mutation θ_risk 게이트(N8 강화·자가단언 하니스·HIGH-gate·채널 루프 hard-AND append)**+**security 채널(4d·결정론 SAST blocking·source-tagged·static+deps만 차단·LLM 제외 N6·`runSecurityCheck` 채널 루프 마지막 append)**+**§11 결함 국소화(4c·부분 착수): 귀속 인식 에스컬레이션 — escalate(impl 계층 소진)→`localizeFault`가 §11 결정론 라벨(`faultTier:'impl_exhausted'`·`counters{impl:attempt+1}`·LLM 0·N6)·`buildDefectBrief`가 `context.attribution`+§15 형태 강화(`db/decision.types.ts` `FaultTier`/`FaultAttribution`은 shared `AttributionCountersSchema` 재사용·드리프트 0)** — develop_code에 한해 P5 시퀀싱 함정 부분 해소(실 security_pass 존재) — 잔여: fuzz(fast-check)·per-tier θ 캘리브레이션(P2r)·**4c 잔여**(진동 누적·graph_dag 영속·재진입(spec_fix→재분해)·task/plan 계층 승급은 P6 라우팅 후속)·Tester 적대 측면·design_ui/security_audit WP 자기검증(4d 잔여) | #269, #271, #273~#275, #292, #294, #295, #296, #297, #298 |
| P5 | fail-closed 릴리스 게이트(M1·N2)·saga 보상·canary/롤백·워크플로 FSM | ◐ 부분 — P5-1 릴리스 게이트 코어(M1·증거 집계·fail-closed-on-absence·`MANAGER_RELEASE_GATE`·migration 014·#302)+**P5-2a 사인오프**(고아 `gate.blocked`→`degraded_release` DecisionRequest→사람 `accept_known`→`recordSignOff`·`MANAGER_RELEASE_SIGNOFF`·#308)+**P5-2b 배포 게이팅**(릴리스 게이트/사인오프를 `deploy_project` 하드 전제·fail-open-on-absence·`MANAGER_DEPLOY_GATE`·#310) / 잔여: P5-3 N2 강등 FSM·saga 보상·canary/롤백 | #302, #308, #310 |
| P6 | 의사결정 브리프(§15)·HumanDecision/SignOff 영속(M9)·강등 모드 FSM·관측성/SLO | ◐ M9 영속(migration 011·#288)+**결함 브리프 배선**(lease escalation→defect_brief DecisionRequest·`MANAGER_DECISION_BRIEF`·M9 첫 런타임 소비·#291)+**사람 결정 라우팅**(§11 `fix_reverify` 폐루프: escalated WP 재진입(reopenLease attempt advance→dispatch_signal)·결정 제출 라우트(authHook·IDOR 404)·`MANAGER_DECISION_ROUTING`·#299)+**C0/C1 결정 대기함 UI**(C0 프로젝트 스코프·project_id·migration 015·#303 / Orchestrator 프록시·DecisionsPanel·JWT decidedBy·#306)+**B1 EXPIRED sweep 생산측**(expiresAt 부여+만료 sweep·M8·#312) — 잔여: **B1 만료 소비자**(`decision.expired` 종단 — 재에스컬/통지)·spec_fix/reject/accept_known 실동작·verification.failed/decomposition.inconsistent 브리프·강등 모드 FSM(N2)·관측성/SLO | #288, #291, #299, #303, #306, #312 |

---

## 진행 예정

post-#286 전면 감사 + post-#312 재감사(7도메인 라이브 대조·적대 검증)가 확정한 슬라이스 순서. **최심 공통 토대부터** 착수 — ~~P6 M9 영속(#288)~~·~~P2r-2 영속(#289)~~·~~P2 간선 추론+epicId(#290)~~·~~P6 결함 브리프(#291)~~·~~P6 fix_reverify 라우팅(#299)~~·~~P5-2 사인오프+배포 게이팅(#308·#310)~~·~~B1 EXPIRED sweep 생산측(#312)~~·~~P2r-3 LLM 생산자(#314)~~·~~P2r-4 라우팅+wp.risk write-back(#316)~~·~~C5 승인 UI(#318)~~·~~D5 §5 모델 라우팅 소비(#320)~~ 완료. **P2r 가치사슬(생산자→라우팅→UI→모델소비)이 #320로 완성** — 사람 승인 시 wp.risk=HIGH 전이로 mutation θ게이트가 실제 발화. 다음(전부 ready_now·prereq 0):

1. **B1 만료 결정 소비자** `[keystone·의존 없음]`: #312가 발행하는 `decision.expired`(manager:decision:main)를 구독하는 소비자가 없어 만료된 blocking 결정이 재에스컬/통지 없이 소멸(M8 위반·종단). `DecisionRecordedConsumer` 골격을 재사용해 분기 소비자 1개 추가 — 결정 생명주기 진짜 폐루프.
2. **G1 서킷브레이커 decompose/advisory 배선** `[의존 없음]`: budget/provider 서킷이 러너 tool-loop만 보호하고 decompose(다단계 LLM)·advisory 경로는 무보호. `callClaudeText` 어댑터로 동일 breaker 인스턴스 주입 — 병렬-비용/장애 폭발 선제 차단.
3. **P5-3 N2 강등 모드 FSM** `[의존 P5-2(#310)]`: 릴리스 게이트 blocked·서킷 트립 시 강등 운영 모드 전이(FSM)·saga 보상·canary/롤백.
4. **D5 후속 + P2 정밀화** `[의존 없음]`: designer/tester/security 에이전트 모델 소비(각 ~2줄·동일 `payload.model ?? config`)·P7 per-WP risk 재채점 / WP `inputs`/`outputs` 채움(계약 체인 §11·impact-DAG 입력)·재진입 머지(`merge_keep_inflight`·N4)·`near_term` 필터.

> ⚠️ **시퀀싱 함정(부분 해소)**: P5 fail-closed 릴리스 게이트(hard-AND)는 P4 security/regression 채널이 **먼저** 착륙해야 한다. **4d security 채널이 develop_code WP에 착륙**(`MANAGER_WP_SECURITY`·결정론 SAST blocking)했으므로 P5는 이제 develop_code에 한해 실 security_pass를 AND할 수 있다. 다만 design_ui/security_audit WP는 여전히 빈 plan(자기검증 부재)이라 auto-pass — 이 WP들에 대한 게이트를 P5에서 먼저 닫으면 채널 skip이 fail-open을 fail-closed로 위장(M1/N1 위반)한다. 4d 잔여(Tester 적대 측면·design_ui/security_audit WP 자기검증)가 그 갭을 메운다.

### 후속·잠복 하드닝

- M6 dedup-then-crash 윈도(처리 전 SETNX EX 86400s → 클레임~완료 사이 크래시 시 무음 유실)
- Manager `StreamConsumer`·`SessionGatewayConsumer` DLQ/바운드재시도 부재(사용자 대면 ingress가 poison 무음 소실 — 자율 내부 소비자엔 DLQ 있는 coverage inversion)
- `OutboxRelay` max-attempts cap·DLQ 부재(영구 실패 행 무한 재시도)
- M7 causation leaf 5곳 null + 메트릭/SLO 0
- WP 생명주기 이벤트 멱등키는 `appendWpEvent`가 event_type 분리로 **해소 완료**(#261)

잠재적 개선 영역:
- xzawedLauncher GitHub Actions 릴리스 파이프라인 (`launcher-release.yml`, `docker-publish.yml`)
- GHCR Docker 이미지 배포 자동화

---

## 아카이브

구현 완료된 초기 설계 스펙과 계획: [docs/archive/](../archive/README.md)

---

## 관련 문서

- [기여 가이드](contributing.md)
- [ADR 목록](adr/README.md)
- [서비스 목록](../README.md)
