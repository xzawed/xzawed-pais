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
| P2 | PM 다단계 분해 파이프라인 + 자가수선 (`MANAGER_DECOMPOSE_ENABLED`) | ◐ 부분 — P6 간선 추론(현재 FLAT WP)·P7 epicId/inputs/outputs 채움·재진입 머지 잔여 | #263~#266 |
| P2r | Wiki Agent 리스크 분류기 (5-슬라이스) | ◐ P2r-1 결정론 코어(shared `risk/`)만 landed·**완전 미배선** — P2r-2 영속·P2r-3 LLM 생산자·P2r-4 라우팅+사람게이트·P7 per-WP 재채점·§5 모델 라우팅 배선 잔여 | #286 |
| 횡단 | WP §7 계약 스키마 정합(S1) + §13 회복탄력성(budget·provider 서킷·벌크헤드) | ✅ 완료 | #282 / #283~#285 |
| P3 | Oracle DoR 게이트 + 초안 생성 (`MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT`) | ◐ 부분 — invariants/golden_refs 미소비·§14 step branch git 워크플로·WP 상태머신(8+2) 잔여 | #267~#268 |
| P4 | 실행 워커 + 실 검증 오라클 (`MANAGER_TASK_WORKER`·`MANAGER_WP_VERIFY`·`MANAGER_WP_CONFORMANCE`) | ◐ 골격+컨텍스트(4a)+correctness 게이트(4b-1)+오라클 conformance(4b-2)+vacuous-pass `passed>0` floor·Oracle 스키마 invariants/golden_refs(4b-3·migration 010) — 잔여: advisory(N3)·impact(golden differential) 채널·전체 mutation 게이트(N8)·§11 결함 국소화(4c)·Tester/Security 적대 에이전트(4d) | #269, #271, #273~#275 |
| P5 | fail-closed 릴리스 게이트(M1·N2)·saga 보상·canary/롤백·워크플로 FSM | ⬜ 미착수 | — |
| P6 | 의사결정 브리프(§15)·HumanDecision/SignOff 영속(M9)·강등 모드 FSM·관측성/SLO | ⬜ 미착수 | — |

---

## 진행 예정

post-#286 전면 감사(spec↔코드 대조·적대 검증)가 확정한 다음 슬라이스 순서. **의존 그래프상 가장 깊은 공통 토대(P6 M9 영속)부터** — P6 surface·강등 사인오프·UI ESCALATED 카드가 전부 여기에 기록하므로 선행하지 않으면 위쪽 작업이 M9를 위반하는(비귀속·휘발) UI를 만들게 된다.

1. **P6 M9 영속 — DecisionRequest/HumanDecision/SignOff (migration 011 + repo)** `[의존 없음]`: 사람 결정을 append-only·불변·비부인으로 기록하는 토대(`HUMAN_DECISION_PERSISTENCE.md`). 기존 `oracle.repo.ts`/`task-graph.repo.ts` 패턴 재사용.
2. **P2r-2 RiskClassification 영속 (migration 012 + repo + 사람승인 전이)** `[의존 P2r-1]`: #286 직후 자연스러운 다음 칸. P2r-3 생산자 sink·P2r-4 승인 게이트 선행. ⚠️ M9와 migration 번호 충돌 방지(M9=011, Risk=012).
3. **P2 P6 간선 추론(`build_dag`) + P7 epicId 전파** `[의존 없음]`: risk와 독립인 가장 싼 정확성 승리 — 현재 FLAT 그래프(전 WP `dependsOn:[]`)는 P1d DAG/topo/step-N·detectCycle을 우회한다.
4. **P6 의사결정 브리프 + escalated/verification.failed 컨슈머 배선** `[의존 #1]`: 발행만 되고 사라지던 escalation을 사람 도달 구조화 핸드오프로 폐합(M8). UI ESCALATED 카드의 서버 측 선행.
5. **P4 §11 결함 위치추적(impl/task/plan 귀속) + N5 진동 차단** `[의존 attribution 쓰기경로]`: 블라인드 lease 재시도를 계약-체인 귀속으로 교체. 최고 레버리지 검증 갭.

> ⚠️ **시퀀싱 함정**: P5 fail-closed 릴리스 게이트(hard-AND)는 P4 security/regression 채널이 **먼저** 착륙해야 한다 — 지금 `verify.ts`가 security_audit/design_ui에 빈 plan을 반환하므로, 게이트를 먼저 만들면 채널 skip이 fail-open을 fail-closed로 위장(M1/N1 위반)한다.

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
