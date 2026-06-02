# CLAUDE.md — xzawedTester

## 프로젝트 개요

xzawedTester는 xzawed 멀티 에이전트 시스템의 **테스트 실행 에이전트**다.
xzawedManager로부터 프로젝트 경로를 받아 테스트를 실행하고 결과를 분석해 반환한다.

**현재 상태: 구현 완료 (61/61 테스트 통과)**

## 핵심 명령어

```bash
# xzawedShared 먼저 빌드 필수
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedTester

pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <파일>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일 → dist/
```

## 디렉토리 구조

```
src/
├── index.ts          # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner 초기화
├── config.ts         # 환경변수 검증 (Zod) — workspaceRoot, testTimeoutMs 포함
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3005)
├── tester.ts         # 테스트 조율 — validateTestCommand(), detectTestCommand(), exec() 호출
├── detector.ts       # 프로젝트 타입 감지; buildCommandWithFiles(); parseTestCounts()
├── executor.ts       # spawn(shell:false) 실행; validatePath() — WORKSPACE_ROOT 검증
├── types.ts          # TestFailure, ManagerToTesterMessageSchema, TesterToManagerMessage
├── streams/
│   ├── consumer.ts   # BaseConsumer 확장 — manager:to-tester:{sessionId}
│   └── producer.ts   # tester:to-manager:{sessionId} 발행
└── claude/
    ├── runner.ts     # Anthropic SDK — 테스트 출력 → TestFailure[] 분석
    └── runner.test.ts
```

## Redis Streams 인터페이스

**Consumer Group:** `tester-consumers`

```typescript
// 수신: manager:to-tester:{sessionId}
interface ManagerToTesterMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'test_request' | 'abort'
  payload: {
    projectPath: string
    testCommand?: string          // 없으면 의존성 기반 자동 감지
    testFiles?: string[]          // 특정 파일만 실행 (선택)
    context: Record<string, unknown>
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: tester:to-manager:{sessionId}
interface TesterToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'test_complete' | 'error'
  payload: {
    success?: boolean
    passed?: number
    failed?: number
    failures?: TestFailure[]
    duration?: number
    content: string
  }
}

interface TestFailure { file: string; testName: string; message: string; suggestion: string }
```

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3005` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |
| `TEST_TIMEOUT_MS` | 선택 | `60000` | 테스트 타임아웃 (ms) |

## 구현 참고사항

**보안 패턴**
- `validateTestCommand()`: `ALLOWED_PREFIXES`(`pnpm`, `npm`, `npx`, `yarn`, `vitest`, `jest`, `mocha`, `pytest`, `cargo test`, `go test`, `make test`) + 셸 메타문자(`;&|`$><`) 이중 차단
- `detectTestCommand()`: `package.json scripts.test`는 신뢰하지 않음 — 의존성(`vitest`, `jest`, `mocha`) 기반 하드코딩 명령어만 반환
- `validatePath()`: `validateWorkspaceRoot()` 호출 후 `fs.realpath`로 심볼릭 링크 우회 차단
- `testFiles` 경로도 개별 `validatePath()` 적용

**동작 특이사항**
- `parseTestCounts()`: Vitest, Jest(`Tests: N failed, N passed`), Cargo(`N passed; N failed`) 포맷 지원
- 테스트 출력은 최대 2000자로 잘라 `content`에 전달
- `executor.ts`: `COREPACK_ENABLE_STRICT=0`, `COREPACK_ENABLE_AUTO_PIN=0` 환경변수 강제 설정

**협업 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변(답변자 역할 — 교차질의 개시·지식 emit은 없음)

**Manager 연결:** `xzawedManager/packages/server/src/tools/run-tests.ts` (`createRunTestsHandler`)
