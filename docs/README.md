# xzawedPAIS 문서 홈

xzawed AI 멀티 에이전트 오케스트레이션 플랫폼 전체 문서.

> **플랫폼 한 줄 요약:** 자연어로 지시하면 9개의 전문 AI 에이전트 팀이 실제 소프트웨어를 만들어주는 시스템.

---

## 빠른 탐색

### 시작하기
| 문서 | 설명 |
|------|------|
| [퀵스타트](getting-started/quickstart.md) | 5분 안에 첫 세션 실행 |
| [설치 가이드](getting-started/installation.md) | 환경 설정 및 설치 |

### 개념
| 문서 | 설명 |
|------|------|
| [플랫폼 개요](concepts/overview.md) | xzawed Suite 전체 구조와 에이전트 계층 |
| [시스템 아키텍처](concepts/architecture.md) | 컴포넌트 구조, 데이터 흐름, 배포 아키텍처 |
| [Redis Streams](concepts/redis-streams.md) | 에이전트 간 비동기 메시징 설계 |
| [세션 관리](concepts/sessions.md) | 세션 상태 머신, 격리, 복구 |
| [Claude 실행기](concepts/claude-runners.md) | CLI / API / Remote 3가지 모드 비교 |
| [동적 UI](concepts/dynamic-ui.md) | UISpec JSON 포맷, form / mockup / progress_board |

### 가이드
| 문서 | 설명 |
|------|------|
| [설정 완전 가이드](guides/configuration.md) | 모든 환경변수, 7가지 시나리오 .env 예제 |
| [로컬 배포](guides/local-deployment.md) | 개인 PC, 멀티 창 모드 |
| [원격 배포](guides/remote-deployment.md) | Railway, Docker, 팀 서버, 보안 |
| [MCP 통합](guides/mcp-integration.md) | Claude Code에 MCP 서버 등록하는 3가지 방법 |

### API 레퍼런스
| 문서 | 설명 |
|------|------|
| [REST API](reference/rest-api.md) | 6개 엔드포인트, 요청/응답 스키마, curl 예제 |
| [WebSocket](reference/websocket.md) | 연결, 이벤트 타입, 재연결 코드 |
| [MCP 도구](reference/mcp-tools.md) | create_session, get_session_status, list_sessions |
| [환경 변수](reference/environment-variables.md) | 전체 변수 목록, 기본값, 검증 규칙 |

---

## 서비스별 문서

| 서비스 | 포트 | 상태 | 역할 |
|--------|------|------|------|
| [Orchestrator](services/orchestrator.md) | 3000 | ✅ 완성 (v0.1.0) | 사용자 지시 수신, Manager에 전달 |
| [Manager](services/manager.md) | 3001 | ✅ 완성 (51/51) | Claude tool-calling, 에이전트 위임 |
| [Planner](services/planner.md) | 3002 | ✅ 완성 | 작업 → Step[] 분해 |
| [Developer](services/developer.md) | 3003 | ✅ 완성 (31/31) | 코드 생성·수정 |
| [Designer](services/designer.md) | 3004 | ✅ 완성 (26/26) | UI 컴포넌트 설계 |
| [Tester](services/tester.md) | 3005 | ✅ 완성 (28/28) | 테스트 실행·분석 |
| [Builder](services/builder.md) | 3006 | ✅ 완성 (v0.2.0) | 빌드 실행·결과 반환 |
| [Watcher](services/watcher.md) | 3007 | ✅ 완성 (26/26) | 파일 변경 감시 스트리밍 |
| [Security](services/security.md) | 3008 | ✅ 완성 (45/45) | OWASP 보안 감사 |

---

## 내부 문서

| 문서 | 설명 |
|------|------|
| [PRD](internal/prd.md) | 제품 요구 사항 (기능/비기능) |
| [기여 가이드](internal/contributing.md) | 개발 환경, 브랜치 전략, 커밋 컨벤션, PR 기준 |
| [변경 이력 — Orchestrator](internal/changelog-orchestrator.md) | Orchestrator 릴리스 이력 |
| [변경 이력 — Builder](internal/changelog-builder.md) | Builder 릴리스 이력 |
| [코딩 컨벤션 — Builder](internal/coding-conventions-builder.md) | Builder 파일 책임 원칙, 에러 처리, 보안 규칙 |
| [Orchestrator 문서 인덱스](internal/index-orchestrator.md) | Orchestrator 서비스 문서 내비게이션 원본 |

## 설계 스펙

| 문서 | 설명 |
|------|------|
| [Orchestrator 설계](specs/2026-05-15-orchestrator-design.md) | 전체 시스템 설계 스펙 |
| [Manager 설계](specs/2026-05-15-manager-design.md) | Manager 설계 스펙 |
| [Builder 설계](specs/2026-05-15-builder-design.md) | Builder 설계 스펙 |
| [Builder 문서 설계](specs/2026-05-15-builder-docs-design.md) | Builder 문서 아키텍처 결정 |
| [Planner 스펙](specs/2026-05-15-planner-spec.md) | Planner Redis 인터페이스 정의 |
| [Developer 스펙](specs/2026-05-15-developer-spec.md) | Developer Redis 인터페이스 정의 |
| [Designer 스펙](specs/2026-05-15-designer-spec.md) | Designer Redis 인터페이스 정의 |
| [Tester 스펙](specs/2026-05-15-tester-spec.md) | Tester Redis 인터페이스 정의 |
| [Watcher 스펙](specs/2026-05-15-watcher-spec.md) | Watcher Redis 인터페이스 정의 |
| [Security 스펙](specs/2026-05-15-security-spec.md) | Security Redis 인터페이스 정의 |

## 구현 계획

| 문서 | 설명 |
|------|------|
| [Orchestrator 서버](plans/2026-05-15-orchestrator-server.md) | 서버 구현 계획 |
| [Orchestrator Electron 앱](plans/2026-05-15-orchestrator-electron-app.md) | Electron 앱 구현 계획 |
| [Builder 초기 구현](plans/2026-05-16-builder-initial-implementation.md) | Builder 구현 계획 (29 테스트) |
| [Builder 문서 계획](plans/2026-05-15-builder-docs.md) | Builder 문서 작성 계획 |
| [Manager 서버](plans/2026-05-15-manager-server.md) | Manager 서버 구현 계획 |

---

## Redis Streams 채널 맵

```
{source}:to-{target}:{sessionId}
consumer group: {target}-consumers
```

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
