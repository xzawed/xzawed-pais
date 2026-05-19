# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedTester는 xzawed 멀티 에이전트 시스템의 **테스트 실행 에이전트**다.
xzawedManager로부터 프로젝트 경로를 받아 테스트를 실행하고 결과를 분석해 반환한다.

현재 상태: **구현 완료 (31/31 테스트 통과)**

## 핵심 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <file>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일
```

## 아키텍처

```
src/
├── index.ts          # 진입점: Redis consumer 시작
├── config.ts         # 환경변수 검증 (zod)
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3005)
├── tester.ts         # 테스트 실행 조율 로직
├── detector.ts       # 프로젝트 타입·테스트 명령 자동 감지
├── executor.ts       # child_process로 테스트 실행 (stdout/stderr 스트리밍); validatePath() — WORKSPACE_ROOT 검증
├── executor.test.ts  # validatePath 경로 검증 3건 (for..of 루프)
├── types.ts          # 메시지 타입, TestFailure 정의
├── streams/
│   ├── consumer.ts   # 구독: manager:to-tester:{sessionId}
│   └── producer.ts   # 발행: tester:to-manager:{sessionId}
└── claude/
    └── runner.ts     # Anthropic SDK — 테스트 실패 분석
```

### 데이터 흐름

1. Redis consumer → `test_request` 수신 (`ManagerToTesterMessage`)
2. `detector.ts` → `package.json` scripts, `pytest.ini` 등으로 테스트 명령 결정
3. `executor.ts` → child_process 실행, stdout/stderr 스트리밍
4. 실패 시 `claude/runner.ts` → 실패 분석 및 `TestFailure[]` suggestion 생성
5. Redis producer → `test_complete` 발행 (`TesterToManagerMessage`)

## Redis Streams 인터페이스

**Consumer Group:** `tester-consumers`

```typescript
// 수신: manager:to-tester:{sessionId}
interface ManagerToTesterMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'test_request' | 'abort'
  payload: {
    projectPath: string
    context: Record<string, unknown>
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

interface TestFailure { test: string; message: string; suggestion: string }
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3005
MODE=local
WORKSPACE_ROOT=/path/to/workspace  # 절대경로 필수
TEST_TIMEOUT_MS=120000
```

## 구현 참고사항

- `detectTestCommand`: `devDependencies`/`dependencies`에서 프레임워크 탐지 후 **하드코딩 명령어** 반환. `package.json scripts.test` 값은 신뢰하지 않음 (보안)
- `validateTestCommand()` (`tester.ts`): Redis 페이로드 `testCommand` 필드에 allowlist + 셸 메타문자 검증 적용
- `executor.ts`: `spawn(bin, args, {shell:false})` — `shell:true` 금지
- 테스트 파일 목 패턴: `vi.resetAllMocks()` + 재설정 패턴 사용
- Manager 연결: `xzawedManager/packages/server/src/tools/run-tests.ts` (`createRunTestsHandler`)

## xzawed 생태계 연결

전체 suite: 현재 저장소 루트
- 에이전트 간 통신: Redis Streams (ioredis), 포트 3002–3008
- 설계 스펙: `docs/services/tester.md`
