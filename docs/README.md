# xzawedPAIS 문서

xzawedPAIS 전체 문서 인덱스. 설치·운영·API 레퍼런스를 찾을 수 있다.

---

## 시작하기

| 문서 | 설명 |
|------|------|
| [설치](getting-started/installation.md) | Node.js·pnpm·Redis 환경 구성 및 서비스 설치 |
| [퀵스타트](getting-started/quickstart.md) | 저장소 클론부터 첫 메시지 전송까지 |

## 개념

| 문서 | 설명 |
|------|------|
| [플랫폼 개요](concepts/overview.md) | 에이전트 계층 구조와 동작 원리 |
| [시스템 아키텍처](concepts/architecture.md) | 컴포넌트 구조, 데이터 흐름, 배포 아키텍처 |
| [Redis Streams](concepts/redis-streams.md) | 에이전트 간 비동기 메시징 설계 |
| [세션 관리](concepts/sessions.md) | 세션 상태 머신, 격리, 복구 |
| [Claude 실행기](concepts/claude-runners.md) | `api` / `cli` / `remote` 세 가지 실행 모드 비교 |
| [동적 UI](concepts/dynamic-ui.md) | UISpec JSON 포맷, form / mockup / progress_board |

## 가이드

| 문서 | 설명 |
|------|------|
| [설정 가이드](guides/configuration.md) | 모든 환경 변수와 시나리오별 `.env` 예제 |
| [로컬 배포](guides/local-deployment.md) | 개인 PC, 멀티 창 모드 |
| [원격 배포](guides/remote-deployment.md) | Railway, Docker, 팀 서버 |
| [MCP 통합](guides/mcp-integration.md) | Claude Code에 MCP 서버 등록하는 세 가지 방법 |

## API 레퍼런스

| 문서 | 설명 |
|------|------|
| [REST API](reference/rest-api.md) | 엔드포인트, 요청/응답 스키마, curl 예제 |
| [WebSocket](reference/websocket.md) | 연결, 이벤트 타입, 재연결 코드 |
| [MCP 도구](reference/mcp-tools.md) | `create_session`, `get_session_status`, `list_sessions` |
| [환경 변수](reference/environment-variables.md) | 전체 변수 목록, 기본값, 검증 규칙 |

---

## 서비스 목록

| 서비스 | 포트 | 역할 |
|--------|------|------|
| [Orchestrator](services/orchestrator.md) | 3000 | 사용자 지시 수신, 의도 정제, Manager에 전달 |
| [Manager](services/manager.md) | 3001 | Claude tool-calling 루프, 에이전트 위임 |
| [Shared](services/shared.md) | — | 공통 라이브러리 (BaseConsumer, validateWorkspaceRoot) |
| [Planner](services/planner.md) | 3002 | 작업 → `Step[]` 분해 |
| [Developer](services/developer.md) | 3003 | 코드 생성·수정 |
| [Designer](services/designer.md) | 3004 | UI 컴포넌트 설계 |
| [Tester](services/tester.md) | 3005 | 테스트 실행·분석 |
| [Builder](services/builder.md) | 3006 | 빌드 실행·결과 반환 |
| [Watcher](services/watcher.md) | 3007 | 파일 변경 감시 스트리밍 |
| [Security](services/security.md) | 3008 | OWASP 보안 감사 |

---

## 개발자 가이드

| 문서 | 설명 |
|------|------|
| [기여 가이드](development/contributing.md) | 개발 환경, 브랜치 전략, 커밋 컨벤션, PR 기준 |
| [코딩 컨벤션](development/conventions.md) | 전 서비스 공통 패턴 (Redis, 경로 보안, TypeScript) |
| [보안 패턴](development/security-patterns.md) | OWASP 보안 구현 패턴 모음 |
| [SonarCloud 가이드](development/sonarcloud.md) | CPD·커버리지·핫스팟 트러블슈팅 |
| [PRD](development/prd.md) | 제품 요구사항 |
| [ADR](development/adr/README.md) | Architecture Decision Records |

## 설계 스펙 (현행)

| 문서 | 설명 |
|------|------|
| [SKILL·Hook·문서 재편](superpowers/specs/2026-05-25-skill-hooks-docs-design.md) | SKILL.md 계층 + Hook 자동화 설계 |
| [프로젝트 레지스트리](superpowers/specs/2026-05-24-project-registry-design.md) | 프로젝트·워크스페이스 관리 설계 |

---

## Redis Streams 채널 맵

스트림 키 형식: `{source}:to-{target}:{sessionId}` / consumer group: `{target}-consumers`

| 채널 키 | 방향 |
|---------|------|
| `orchestrator:to-manager:{sid}` | Orchestrator → Manager |
| `manager:to-orchestrator:{sid}` | Manager → Orchestrator |
| `manager:to-planner:{sid}` | Manager → Planner |
| `planner:to-manager:{sid}` | Planner → Manager |
| `manager:to-developer:{sid}` | Manager → Developer |
| `developer:to-manager:{sid}` | Developer → Manager |
| `manager:to-designer:{sid}` | Manager → Designer |
| `designer:to-manager:{sid}` | Designer → Manager |
| `manager:to-tester:{sid}` | Manager → Tester |
| `tester:to-manager:{sid}` | Tester → Manager |
| `manager:to-builder:{sid}` | Manager → Builder |
| `builder:to-manager:{sid}` | Builder → Manager |
| `manager:to-watcher:{sid}` | Manager → Watcher |
| `watcher:to-manager:{sid}` | Watcher → Manager |
| `manager:to-security:{sid}` | Manager → Security |
| `security:to-manager:{sid}` | Security → Manager |

---

## 아카이브

구현 완료된 초기 스펙·계획: [docs/archive/](archive/README.md)
