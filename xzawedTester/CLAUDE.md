# CLAUDE.md — xzawedTester

## 프로젝트 개요

xzawedTester는 xzawed 멀티 에이전트 시스템의 **테스트 실행 에이전트**다.
xzawedManager로부터 프로젝트 경로를 받아 테스트를 실행하고 결과를 분석해 반환한다.

## 구조

`src/` 트리 → [docs/services/tester.md](../docs/services/tester.md#architecture). **여기 복사하지 않는다** —
두 벌을 손으로 유지하다 양쪽이 다 낡았다(한쪽은 없는 파일을, 다른 쪽은 없는 테스트를 적고 있었다).
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

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

이 서비스 고유 변수만 적는다.

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `TEST_TIMEOUT_MS` | 선택 | `60000` | 테스트 실행 타임아웃 (ms) |

## 구현 참고사항

**보안 패턴**
- `validateTestCommand()`: `ALLOWED_PREFIXES`(`pnpm`, `npm`, `npx`, `yarn`, `vitest`, `jest`, `mocha`, `pytest`, `cargo test`, `go test`, `make test`) + 셸 메타문자(`;&|`$><`) 이중 차단
- `detectTestCommand()`: `package.json scripts.test`는 신뢰하지 않음 — **하드코딩 명령만 반환**한다 — 의존성 매칭(`vitest`/`jest`/`mocha`), 매칭 실패 시 `pnpm test`, `Cargo.toml` 이면 `cargo test`, 그 외에는 **throw**(감지 실패를 통과로 세지 않는다)
- `validatePath()`: `validateWorkspaceRoot()` → **`workspaceRoot` 기준 앵커** → `fs.realpath`로 심볼릭 링크 우회 차단. **상대경로는 cwd 가 아니라 `workspaceRoot` 기준으로 푼다** — 계약(루트 CLAUDE.md)이 그렇게 못박고 있는데 예전엔 원시 인자를 그대로 realpath 해 서버 프로세스 cwd 기준이었다. 절대경로는 손대지 않는다(`path.resolve(root, abs)` 는 win32 에서 POSIX 절대경로를 드라이브 상대로 재해석해 로컬↔CI 를 갈라놓는다)
- `testFiles` 경로도 개별 `validatePath()` 적용

**동작 특이사항**
- **`validatePath` 는 경로가 이미 존재할 것을 요구한다.** `realpath` 실패는 거부다 — Developer 는 없는 파일을 만들지만 Tester 는 **없는 `projectPath`·테스트 파일에 대해 돌지 못한다**(심볼릭 링크 탈출 방어와 별개의 fail-closed)
- **명령은 공백 분해 후 `spawn(bin, args, {shell:false})` 다.** `cargo test` 가 도는 이유는 `['cargo','test']` 로 갈리기 때문이고, 그래서 **공백이 든 `testFiles` 는 거부**한다
- `parseTestCounts()`: Vitest, Jest(`Tests: N failed, N passed`), Cargo(`N passed; N failed`) 포맷 지원
- 테스트 출력은 최대 2000자로 잘라 `content`에 전달
- `executor.ts`: `COREPACK_ENABLE_STRICT=0`, `COREPACK_ENABLE_AUTO_PIN=0` 환경변수 강제 설정

**협업 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변(답변자 역할 — **교차질의 개시는 없으나 지식 emit 은 한다**: `extractKnowledge` 결과를 `test_complete` 에 싣는다)

**Manager 연결:** `xzawedManager/packages/server/src/tools/run-tests.ts` (`createRunTestsHandler`)
