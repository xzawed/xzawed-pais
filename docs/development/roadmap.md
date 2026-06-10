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
| P2 | PM 다단계 분해 파이프라인 + 자가수선 (`MANAGER_DECOMPOSE_ENABLED`) | ◐ 부분 — Wiki Agent 리스크 분류·모델 라우팅·P6 간선 추론 잔여 | #263~#266 |
| P3 | Oracle DoR 게이트 + 초안 생성 (`MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT`) | ◐ 부분 — invariants·golden_refs·step branch 잔여 | #267~#268 |
| P4 | 실행 워커 + 실 검증 오라클 (`MANAGER_TASK_WORKER`·`MANAGER_WP_VERIFY`·`MANAGER_WP_CONFORMANCE`) | ◐ 골격+컨텍스트(4a)+검증 게이트(4b-1 correctness 채널)+오라클 conformance(4b-2 step-def 컴파일·승인 GWT→실행 테스트) — 4b-3 advisory/impact·mutation(N8)·4c 결함 국소화·4d 검증 에이전트 잔여 | #269, #271, #273 |
| P5 | fail-closed 릴리스 게이트·saga 보상·canary/롤백 | ⬜ 미착수 | — |
| P6 | 의사결정 브리프·HumanDecision/SignOff 영속(M9)·관측성 | ⬜ 미착수 | — |

---

## 진행 예정

senario 로드맵의 다음 슬라이스 순서:

1. **P4b 잔여 — 실 검증 오라클 확장**: advisory/impact 채널·mutation 게이트(4b-3, N8)·invariants/golden_refs·구조화 step_defs. 4b-1(correctness 채널 골격 — 결과-근거 판정+파생 빌드·테스트 실 재실행, `MANAGER_WP_VERIFY`)·4b-2(오라클 conformance — 사람 승인 GWT→독립 develop_code author→Tester 실행·N1·N6, `MANAGER_WP_CONFORMANCE`)는 완료.
2. **사람 접점 UI**: 오라클 승인·편집 카드, decompose 트리거 UX(P4a-2 userContext 채움 포함), ESCALATED WP 재개입 경로, Task Graph 상태 모니터링.
3. **잠복 하드닝**: WP 생명주기 이벤트 멱등키 공유 해소, M6 무음 유실(핸들러 트랜잭션 멱등), Manager StreamConsumer·OutboxRelay DLQ, DLQ 재처리 도구.

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
