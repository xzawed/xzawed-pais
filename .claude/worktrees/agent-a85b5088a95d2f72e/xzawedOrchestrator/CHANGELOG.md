# 변경 이력

이 프로젝트의 모든 주목할 만한 변경 사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)를 따르며,
이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 사용합니다.

---

## [미출시]

### 추가 예정
- Electron 데스크탑 앱 (packages/app)
- RemoteCLIRunner SSH 구현
- Claude 오케스트레이터 의도 파악·정제 로직
- JWT 인증 상세 구현

---

## [0.1.0] — 2026-05-15

### 추가
- pnpm workspaces + Turborepo 기반 모노레포 초기 설정
- `packages/shared`: 공통 TypeScript 타입 (Message, Session, UISpec, Streams)
- `packages/server`: Fastify 5 기반 백엔드 서버
  - REST API: `POST /sessions`, `POST /sessions/:id/messages`, `GET /sessions/:id/messages`, `GET /sessions/:id/tasks`, `GET /health`
  - WebSocket: `/ws/sessions/:id` 실시간 스트리밍
  - MCP 서버 (stdio): `create_session`, `get_session_status`, `list_sessions` 도구
  - Claude 실행기: CLIRunner (claude CLI 서브프로세스), APIRunner (@anthropic-ai/sdk)
  - Redis Streams: StreamProducer, StreamConsumer (ACK 기반 신뢰 전송)
  - 세션 관리: SessionStore (인메모리), 세션 상태 머신
- `MODE=local/remote`, `CLAUDE_MODE=cli/api/remote`, `AUTH=none/jwt` 설정
- Redis 미설치 시 ioredis-mock 인메모리 폴백
- Vitest 기반 단위 테스트 (config, API, 세션, Claude 실행기, Streams)
- `.env.example` 환경변수 템플릿

[미출시]: https://github.com/xzawed/orchestrator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xzawed/orchestrator/releases/tag/v0.1.0
