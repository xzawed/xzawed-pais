# CLAUDE.md — xzawedTester

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedTester는 xzawed 멀티 에이전트 시스템의 **테스트 에이전트**다.
xzawedManager로부터 코드 아티팩트를 받아 테스트를 작성·실행하고 품질 보고서를 반환한다.

## 역할 및 책임

- 단위·통합·E2E 테스트 코드 자동 생성
- 테스트 실행 및 결과 수집
- 실패한 테스트에 대한 원인 분석 및 수정 제안
- 커버리지 보고서 생성

## Redis Streams 인터페이스

**수신:** `manager:to-tester:{sessionId}`
**발신:** `tester:to-manager:{sessionId}`
**Consumer Group:** `tester-consumers`

### 수신 메시지 (ManagerToTesterMessage)

```typescript
interface ManagerToTesterMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_request' | 'abort'
  payload: {
    artifacts: FileChange[]           // 테스트 대상 파일
    testTypes: TestType[]
    projectPath: string
    context: Record<string, unknown>
  }
}

type TestType = 'unit' | 'integration' | 'e2e'
```

### 발신 메시지 (TesterToManagerMessage)

```typescript
interface TesterToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_complete' | 'test_progress' | 'info_request' | 'error'
  payload: {
    passed?: number
    failed?: number
    skipped?: number
    coverage?: number                 // 0-100
    report?: string                   // 상세 결과
    failures?: TestFailure[]
    content: string
  }
}

interface TestFailure {
  testName: string
  error: string
  suggestion: string
}
```

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health`) |
| Claude SDK | `@anthropic-ai/sdk` |
| Redis | `ioredis` |
| 테스트 실행 | `node:child_process` (vitest, jest, pytest 등 실행) |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm |

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

## 레포 초기 구조

```
xzawedTester/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts
    ├── config.ts
    ├── server.ts
    ├── streams/
    │   ├── consumer.ts   # manager:to-tester:{sessionId}
    │   └── producer.ts   # tester:to-manager:{sessionId}
    ├── claude/
    │   └── runner.ts
    ├── executor.ts       # child_process로 테스트 실행
    └── tester.ts         # 테스트 생성 + 실행 조율 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `test_request` 수신
2. Claude로 artifacts에 대한 테스트 코드 생성
3. `executor.ts`로 실제 테스트 실행 (WORKSPACE_ROOT 하위)
4. 결과 파싱 후 `test_complete` 발신

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## 보안 고려사항

- `WORKSPACE_ROOT` 외부 경로 실행 차단
- 테스트 실행 타임아웃 적용 (`TEST_TIMEOUT_MS`)
- 무한 루프·리소스 과다 사용 프로세스 강제 종료

## xzawedManager와의 연결

xzawedManager의 `run_tests` 도구가 이 서비스로 위임된다.
Manager의 `tools/run-tests.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.
