# xzawedBuilder — 아키텍처 상세

## 컴포넌트 인터페이스 계약

### detector.ts

```typescript
interface BuildDetectionResult {
  command: string      // 실행할 빌드 명령어
  buildRoot: string    // 빌드 파일이 발견된 디렉토리
}

// projectPath에서 workspaceRoot까지 상향 탐색
async function detectBuildInfo(projectPath: string, workspaceRoot?: string): Promise<BuildDetectionResult>

// detectBuildInfo의 command만 반환하는 래퍼
async function detectBuildCommand(projectPath: string, workspaceRoot?: string): Promise<string>
```

탐색 순서 (각 디렉토리에서):
1. `Cargo.toml` → `cargo build --release`
2. `Makefile` → `make build`
3. `package.json` → 의존성(`vite`, `webpack`, `typescript`) 기반 `pnpm run build` (`scripts.build` 값 미사용)
4. `go.mod` → `go build ./...`

`projectPath`에서 시작해 `workspaceRoot`(또는 파일시스템 루트)에 도달할 때까지 각 부모 디렉토리를 순서대로 검사한다. 에이전트가 하위 경로에 파일을 생성하고 빌드 파일은 상위에 있는 경우를 처리한다.

---

### executor.ts

```typescript
interface ExecResult {
  success: boolean
  output: string      // stdout + stderr 합산
  exitCode: number
  duration: number    // ms
}

// 경로 보안 검증 (WORKSPACE_ROOT 상한선 적용)
async function validatePath(projectPath: string, workspaceRoot: string): Promise<string>

// 빌드 프로세스 실행 (shell:false)
async function exec(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void | Promise<void>,
  timeoutMs: number
): Promise<ExecResult>
```

`exec()`의 동작:
- 명령어를 공백으로 분리해 `spawn(bin, args, {shell:false})`로 실행
- `bin`이 빈 문자열이면 즉시 `throw new Error('Empty command')`
- `COREPACK_ENABLE_STRICT=0`, `COREPACK_ENABLE_AUTO_PIN=0` 환경변수 강제 설정
- stdout/stderr 청크를 `onChunk` 콜백으로 즉시 전달 (버퍼링 없음)
- `timeoutMs` 초과 시 `proc.kill('SIGTERM')` 후 reject

`validatePath()`의 동작:
- `validateWorkspaceRoot(workspaceRoot)` 호출 (파일시스템 루트 거부)
- `fs.realpath()`로 실제 경로 확인 (심볼릭 링크 우회 차단)
- `path.relative(realRoot, realProject)`가 `..`로 시작하거나 절대경로면 throw

---

### builder.ts

```typescript
class Builder {
  async handle(message: ManagerToBuilderMessage): Promise<void>
  private async stripPackageManagerField(buildRoot: string): Promise<void>
  private async runPreInstall(buildRoot: string, sessionId: string): Promise<void>
  private makeProgress(sessionId: string, content: string): BuilderToManagerMessage
}
```

`handle()`의 전처리 단계:
1. `validatePath(projectPath, workspaceRoot)` — 경로 검증
2. `payload.command` 유무에 따라 `validateBuildCommand()` 또는 `detectBuildInfo()` 호출
3. `stripPackageManagerField(buildRoot)` — `package.json`의 `packageManager` 필드 제거
4. `runPreInstall(buildRoot)` — `node_modules` 없으면 의존성 설치

`validateBuildCommand()`의 allowlist:
```
pnpm, npm, npx, yarn,
cargo build, make, cmake,
gradle, mvn, go build,
tsc, webpack, vite build
```
셸 메타문자(`;&|`$><`) 포함 시 즉시 throw.

---

### claude/runner.ts

```typescript
async function analyzeBuildFailure(output: string): Promise<BuildError[]>
```

Anthropic SDK `messages.create` 호출. 빌드 로그를 입력으로 받아 `BuildError[]` JSON 반환을 요청한다.
SDK 오류나 파싱 실패 시 `[{ message: output, suggestion: 'Claude 분석 실패' }]`로 fallback.

```typescript
interface BuildError {
  file?: string       // 오류 발생 파일 경로
  line?: number       // 오류 발생 줄 번호
  message: string     // 오류 메시지 (필수)
  suggestion: string  // Claude 수정 제안 (필수)
}
```

---

## 에러 처리 흐름

```
build_request 수신
    │
    ├─ validatePath 실패 ─────────────────────────→ error 발행
    │
    ├─ validateBuildCommand 실패 ─────────────────→ error 발행
    │
    └─ exec() 실행
            │
            ├─ exitCode === 0 ────────────────────→ build_complete (success: true)
            │
            ├─ exitCode !== 0
            │       ├─ analyzeBuildFailure 성공 → build_complete (success: false, errors: BuildError[])
            │       └─ analyzeBuildFailure 실패 → build_complete (success: false, errors: fallback)
            │
            └─ BUILD_TIMEOUT_MS 초과
                    └─ SIGTERM → error 발행
```

---

## 세션 생명주기

```
Redis Consumer Group 'builder-consumers'
    │
    ├─ XREADGROUP (block 0) 대기
    │
    ├─ build_request 수신
    │       ├─ XACK 즉시 (빌드 완료 전에 ACK — PEL 누수 방지)
    │       └─ builder.handle() 비동기 실행
    │
    └─ abort 수신
            └─ sessionId 일치 시 child_process.kill('SIGTERM')
```

> `abort`는 현재 실행 중인 세션의 `sessionId`와 일치할 때만 처리한다.

---

## WORKSPACE_ROOT 경로 검증

```
projectPath 수신
    │
    ├─ validateWorkspaceRoot(workspaceRoot)
    │       └─ 파일시스템 루트(/, C:\)이면 throw
    │
    ├─ fs.realpath(projectPath) — 심볼릭 링크 실제 경로 확인
    │
    ├─ path.relative(realRoot, realProject).startsWith('..')
    │       └─ true → throw Error('경로 거부')
    │
    └─ path.isAbsolute(relative)
            └─ true → throw Error('경로 거부')
```

`path.resolve` 대신 `fs.realpath`를 사용해 심볼릭 링크를 통한 WORKSPACE_ROOT 우회를 차단한다.

---

## 코딩 컨벤션

| 파일 | 허용 | 금지 |
|---|---|---|
| `detector.ts` | 빌드 명령 감지 (fs 읽기만) | child_process 실행, Redis 접근 |
| `executor.ts` | child_process 실행 + 경로 검증 | Redis 발행, 빌드 로직 |
| `builder.ts` | 감지·실행·전처리 조율 | 직접 Redis 접근 |
| `streams/producer.ts` | Redis 메시지 발행 | 빌드 로직 |
| `claude/runner.ts` | Anthropic SDK 호출 | 파일시스템 접근, Redis 접근 |

stdout/stderr 청크는 수신 즉시 `build_progress`로 발행한다 (버퍼 금지).
