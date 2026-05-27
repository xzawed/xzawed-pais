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

## 진행 예정

현재 확정된 향후 계획은 없다. 플랫폼의 주요 기능 구현이 완료되었으며, 이슈 트래커를 통해 다음 작업이 결정된다.

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
