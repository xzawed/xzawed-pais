# Changelog

## [0.2.0] - 2026-05-16

### Added
- Consumer exponential backoff 자동 재시작 (1s → 30s, Redis 연결 끊김 시 루프 복구)
- 수신 Redis 메시지 런타임 Zod 검증 — 잘못된 메시지는 xack 후 스킵, 핸들러 호출 안 함
- `sleep` 주입 가능 파라미터로 Consumer 테스트 용이성 향상

### Fixed
- `ManagerToBuilderMessage` 타입을 `interface`에서 `z.infer<typeof Schema>`로 전환해 런타임과 타입 정의 일치

---

## [0.1.0] - 2026-05-16

### Added
- Redis Streams XREADGROUP 기반 빌드 요청 수신 (`manager:to-builder:{sessionId}`)
- 빌드 명령 자동 감지: `package.json` scripts → `Cargo.toml` → `Makefile` 순서
- `child_process` 스트리밍 빌드 실행 (`build_progress` 실시간 발행)
- 빌드 실패 시 Anthropic Claude SDK로 오류 분석 및 `BuildError[]` suggestion 생성
- `build_complete` / `error` 결과 발행 (`builder:to-manager:{sessionId}`)
- Fastify `GET /health` 엔드포인트 (포트 3006)
- `WORKSPACE_ROOT` 외부 경로 차단 (`path.relative` 기반 path traversal 방어)
- `BUILD_TIMEOUT_MS` 타임아웃 강제 적용 (기본 120초, SIGTERM으로 프로세스 종료)
- zod 기반 환경변수 검증 (7개 변수, 필수/선택 구분)
- SIGTERM graceful shutdown (consumer 중지 → HTTP 서버 종료 → Redis 연결 해제)
