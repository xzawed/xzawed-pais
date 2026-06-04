# xzawedTester — 테스트 실행 에이전트

xzawedManager로부터 프로젝트 경로와 테스트 명령을 받아 테스트를 실행하고, 실패 시 Claude로 원인을 분석해 결과를 반환한다.

**포트:** 3005 | **상태:** 구현 완료 (테스트 수량은 루트 CLAUDE.md 서비스 표 참조)

---

## Overview

xzawedTester는 다중 언어·프레임워크의 테스트 실행을 담당한다. `detector.ts`가 `package.json` 의존성 및 프로젝트 구조를 분석해 안전한 테스트 명령을 자동 감지하고, `executor.ts`가 `spawn(shell:false)`로 프로세스를 격리 실행한다. 실패가 발생하면 `claude/runner.ts`가 Anthropic API로 실패 원인을 분석해 `TestFailure[].suggestion`을 생성한다.

**입력:** `manager:to-tester:{sessionId}` 스트림의 `test_request` 메시지  
**출력:** `tester:to-manager:{sessionId}` 스트림의 `test_complete` 또는 `error` 메시지

---

## Redis Streams 인터페이스

**Consumer Group:** `tester-consumers`

### 수신 (ManagerToTesterMessage)

```typescript
interface ManagerToTesterMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_request' | 'abort'
  payload: {
    projectPath: string
    testCommand?: string          // 없으면 의존성 기반 자동 감지
    testFiles?: string[]          // 특정 파일만 실행 (선택)
    context: Record<string, unknown>
    userContext?: {
      userId: string
      projectId: string
      workspaceRoot: string
      githubRepo?: { owner: string; repo: string; branch: string }
    }
  }
}
```

### 발신 (TesterToManagerMessage)

```typescript
interface TesterToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_complete' | 'error'
  payload: {
    success?: boolean
    passed?: number
    failed?: number
    failures?: TestFailure[]
    duration?: number             // ms
    content: string
  }
}

interface TestFailure {
  file: string
  testName: string
  message: string
  suggestion: string             // Claude가 생성한 수정 제안
}
```

---

## Architecture

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner 초기화
├── config.ts             # 환경변수 검증 (Zod) — workspaceRoot, testTimeoutMs 포함
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3005)
├── tester.ts             # 테스트 조율 — validateTestCommand(), detectTestCommand(), exec() 호출
├── detector.ts           # 프로젝트 타입 감지 (의존성 기반 하드코딩 명령어 반환); parseTestCounts()
├── executor.ts           # spawn(shell:false) 실행; validatePath() — WORKSPACE_ROOT 검증
├── types.ts              # TestFailure, ManagerToTesterMessageSchema, TesterToManagerMessage 정의
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-tester:{sessionId} 구독
│   └── producer.ts       # tester:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts         # Anthropic SDK — 테스트 출력 → TestFailure[] 분석
```

### 데이터 흐름

1. `consumer.ts` → `test_request` 수신, `ManagerToTesterMessageSchema.safeParse()`로 검증
2. `tester.ts` → `validatePath()`로 경로 검증, `validateTestCommand()`로 allowlist 확인
3. `detector.ts` → `package.json` 의존성 또는 `Cargo.toml` 존재로 테스트 명령 결정
4. `executor.ts` → `spawn(bin, args, {shell:false})`로 프로세스 실행, stdout/stderr 스트리밍
5. 실패 시 `claude/runner.ts` → `TestFailure[]` 생성
6. `producer.ts` → `test_complete` 발행

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3005` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 (`local` \| `remote`) |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |
| `TEST_TIMEOUT_MS` | 선택 | `60000` | 테스트 프로세스 타임아웃 (ms) |

---

## Development

```bash
# 의존성 설치 (xzawedShared 먼저 빌드 필수)
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedTester
pnpm install

pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 실행
pnpm test <파일>   # 단일 파일
pnpm build         # TypeScript 컴파일 → dist/
```

### 구현 참고사항

- `validateTestCommand()`: `ALLOWED_PREFIXES` 목록(`pnpm`, `npm`, `npx`, `yarn`, `vitest`, `jest`, `mocha`, `pytest`, `cargo test`, `go test`, `make test`) + 셸 메타문자(`;&|`$><`) 이중 차단
- `detectTestCommand()`: `package.json scripts.test`는 신뢰하지 않음 — 의존성(`vitest`, `jest`, `mocha`) 기반 하드코딩 명령어만 반환
- `validatePath()`: `@xzawed/agent-streams`의 `validateWorkspaceRoot()` 호출 후 `fs.realpath`로 심볼릭 링크 우회 차단
- `parseTestCounts()`: Vitest(`N passed/failed`), Jest(`Tests: N failed, N passed`), Cargo(`N passed; N failed`) 포맷 지원
- `testFiles` 경로 검증: 각 파일도 `validatePath()`로 개별 검증

---

## Related

- [xzawedShared CLAUDE.md](../../xzawedShared/CLAUDE.md) — BaseConsumer, validateWorkspaceRoot
- [xzawedManager tools/run-tests.ts](../../xzawedManager/packages/server/src/tools/run-tests.ts)
- [서비스 목록](../README.md)
