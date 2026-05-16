# xzawedTester — 테스트 에이전트

**역할:** xzawedManager로부터 테스트 실행 요청을 받아 테스트를 수행하고 결과를 반환한다.

**포트:** 3005 | **상태:** 구현 완료 (28/28 테스트)

---

## 소스 구조

```
src/
├── index.ts
├── config.ts
├── server.ts            # Fastify /health
├── tester.ts            # 테스트 조율 로직
├── streams/
│   ├── consumer.ts      # manager:to-tester:{sessionId}
│   └── producer.ts      # tester:to-manager:{sessionId}
└── claude/
    └── runner.ts        # 실패 분석 (Anthropic SDK)
```

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
    testCommand?: string          // 없으면 자동 감지
    testFiles?: string[]          // 특정 파일만 실행 (선택)
    context: Record<string, unknown>
  }
}
```

### 발신 (TesterToManagerMessage)

```typescript
interface TesterToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_complete' | 'test_progress' | 'error'
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
  suggestion: string
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3005
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
TEST_TIMEOUT_MS=60000
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager 연결

`tools/run-tests.ts`의 `ClaudeStubHandler`를 `RedisAgentHandler`로 교체하면 연결 완료.
