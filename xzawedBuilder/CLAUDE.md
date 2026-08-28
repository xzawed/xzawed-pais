# CLAUDE.md — xzawedBuilder

## 프로젝트 개요

xzawedBuilder는 xzawed 멀티 에이전트 시스템의 **빌드 에이전트**다.
xzawedManager로부터 프로젝트 경로와 빌드 타깃을 받아 빌드를 실행하고 결과 아티팩트를 반환한다.

## 구조

`src/` 트리 → [docs/services/builder.md](../docs/services/builder.md#architecture). **여기 복사하지 않는다** —
두 벌을 손으로 유지하다 양쪽이 다 낡았다(한쪽은 없는 파일을, 다른 쪽은 없는 테스트를 적고 있었다).
## Redis Streams 인터페이스

**Consumer Group:** `builder-consumers`

```typescript
// 수신: manager:to-builder:{sessionId}
interface ManagerToBuilderMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'build_request' | 'abort'
  payload: {
    projectPath: string
    target: 'development' | 'production'
    command?: string              // 없으면 의존성 기반 자동 감지
    context: Record<string, unknown>
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: builder:to-manager:{sessionId}
interface BuilderToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'build_complete' | 'build_progress' | 'error'
  payload: {
    success?: boolean
    output?: string               // 빌드 로그 전체
    artifacts?: string[]          // 생성된 파일 경로
    duration?: number             // ms
    errors?: BuildError[]
    content: string
  }
}

interface BuildError { file?: string; line?: number; message: string; suggestion: string }
```

## 환경 변수

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

이 서비스 고유 변수만 적는다.

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `BUILD_TIMEOUT_MS` | 선택 | `120000` | 빌드 타임아웃 (ms) |

## 구현 참고사항

**보안 패턴**
- `validateBuildCommand()`: `ALLOWED_PREFIXES`(`pnpm`, `npm`, `npx`, `yarn`, `cargo build`, `make`, `cmake`, `gradle`, `mvn`, `go build`, `tsc`, `webpack`, `vite build`) + 셸 메타문자·개행(`\n\r`) 이중 차단. ⚠️ allowlist는 **의도적으로 관용적**(빌드=임의 코드 실행이 빌드 에이전트의 본질) — 진짜 방어는 `executor.ts`의 `spawn(shell:false)`(셸 미경유)이고 allowlist+메타문자 차단은 defense-in-depth. 프리픽스 축소는 legit 빌드(`npx vite build` 등)를 깨므로 하지 않음
- `detector.ts`: `package.json scripts.build`는 신뢰하지 않음 — 의존성 기반 하드코딩 명령어만 반환
- `executor.ts`: `spawn(bin, args, {shell:false})` 고정. `bin`이 빈 문자열이면 즉시 throw
- `validatePath()`: `validateWorkspaceRoot()` → **`workspaceRoot` 기준 앵커** → `fs.realpath`로 심볼릭 링크 우회 차단. **상대경로는 cwd 가 아니라 `workspaceRoot` 기준으로 푼다** — 계약(루트 CLAUDE.md)이 그렇게 못박고 있는데 예전엔 원시 인자를 그대로 realpath 해 서버 프로세스 cwd 기준이었다. 절대경로는 손대지 않는다(`path.resolve(root, abs)` 는 win32 에서 POSIX 절대경로를 드라이브 상대로 재해석해 로컬↔CI 를 갈라놓는다)

**전처리 단계 (builder.ts)**
- `stripPackageManagerField()`: Corepack 충돌 방지를 위해 빌드 전 `package.json`의 `packageManager` 필드 제거
- `runPreInstall()`: `node_modules` 없을 때만 실행; `pnpm-lock.yaml` 있으면 `pnpm install`, 없으면 `npm install`

**빌드 명령 감지 (detector.ts)**
- `detectBuildInfo()`: `projectPath`에서 `workspaceRoot`까지 상향 탐색 → Cargo.toml → Makefile → package.json → go.mod 순서

**스트리밍:** stdout/stderr 청크를 즉시 `build_progress`로 발행 (버퍼링 없음)

**협업 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변(답변자 역할 — 교차질의 개시·지식 emit은 없음)

**Manager 연결:** `xzawedManager/packages/server/src/tools/build-project.ts` (`createBuildProjectHandler`)
