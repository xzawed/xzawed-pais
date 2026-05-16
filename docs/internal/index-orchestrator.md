# xzawedOrchestrator 문서

xzawedOrchestrator(프로젝트 지휘자) 공식 문서입니다. 왼쪽 네비게이션 또는 아래 표를 통해 원하는 문서로 이동하세요.

---

## 시작하기

| 문서 | 설명 |
|------|------|
| [퀵스타트](quickstart.md) | 5분 안에 서버를 실행하고 첫 세션을 만드는 방법 |
| [설치 가이드](guides/installation.md) | Prerequisites, 단계별 설치, 설치 확인 |

---

## 핵심 개념

xzawedOrchestrator를 이해하는 데 필요한 핵심 개념을 설명합니다.

| 문서 | 설명 |
|------|------|
| [xzawed Suite 개요](concepts/overview.md) | xzawed 멀티 에이전트 시스템 전체 설명과 지휘자의 역할 |
| [시스템 아키텍처](concepts/architecture.md) | 패키지 구조, 컴포넌트 책임, 데이터 흐름 |
| [세션 수명주기](concepts/sessions.md) | 세션이란 무엇인지, 상태 머신, 세션 격리 방식 |
| [Claude 실행 모드](concepts/claude-runners.md) | CLI / API / 원격 세 가지 실행 모드 비교 |
| [Redis Streams 메시징](concepts/redis-streams.md) | 비동기 메시지 버스 구조, ACK 기반 신뢰성 |
| [동적 UI 패널](concepts/dynamic-ui.md) | 서버 주도 UI 렌더링 시스템 |

---

## 가이드

구체적인 작업을 수행하는 방법을 단계별로 안내합니다.

| 문서 | 설명 |
|------|------|
| [설치 및 환경 설정](guides/installation.md) | 개발·운영 환경 구축 |
| [설정 옵션 완전 가이드](guides/configuration.md) | 모든 설정 값과 시나리오별 .env 예시 |
| [로컬 단일 사용자 배포](guides/local-deployment.md) | 개인 PC에서 Redis 없이도 실행하기 |
| [원격/팀 서버 배포](guides/remote-deployment.md) | Railway 배포, 팀 모드, 보안 설정 |
| [MCP 서버 통합](guides/mcp-integration.md) | Claude Code에서 MCP 도구로 등록하는 방법 |

---

## 레퍼런스

API 및 설정에 대한 상세 참조 문서입니다.

| 문서 | 설명 |
|------|------|
| [REST API](reference/rest-api.md) | 모든 엔드포인트, 요청/응답 스키마, curl 예시 |
| [WebSocket 프로토콜](reference/websocket.md) | 연결 방법, 이벤트 타입, 메시지 포맷 |
| [MCP 도구 레퍼런스](reference/mcp-tools.md) | 각 MCP 도구 파라미터와 반환값 |
| [환경변수 전체 목록](reference/environment-variables.md) | 모든 환경변수 이름, 기본값, 필수 여부, 설명 |

---

## 내부 문서

| 문서 | 설명 |
|------|------|
| [Product Requirements Document](internal/prd.md) | 기능 요구사항, 비기능 요구사항 |

---

## 관련 링크

- [GitHub 저장소](https://github.com/xzawed/orchestrator)
- [CHANGELOG](../CHANGELOG.md)
- [기여 가이드](../CONTRIBUTING.md)
