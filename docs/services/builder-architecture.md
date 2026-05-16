# 아키텍처

## 컴포넌트 인터페이스 계약

### detector.ts

```typescript
// 입력: 프로젝트 루트 경로
// 출력: 실행할 빌드 명령 문자열
async function detectBuildCommand(projectPath: string): Promise<string>
```

감지 순서 (우선순위):
1. `package.json` 존재 + `scripts.build` 필드 있음 → 해당 값 사용
   `package.json` 존재 + `scripts.build` 필드 없음 → `pnpm run build` (기본값)
2. `Cargo.toml` 존재 → `cargo build --release`
3. `Makefile` 존재 → `make build`
4. 위 모두 없음 → Error('빌드 명령을 감지할 수 없음')

### executor.ts

```typescript
interface ExecResult {
  success: boolean
  output: string      // stdout + stderr 합산
  exitCode: number
  duration: number    // ms
}

// onChunk: 실시간 스트리밍 콜백 (build_progress 발행에 사용)
async function exec(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void,
  timeoutMs: number
): Promise<ExecResult>
```

### claude/runner.ts

```typescript
interface AnalysisResult {
  errors: BuildError[]
}

async function analyzeBuildFailure(output: string): Promise<AnalysisResult>
```

Anthropic SDK `messages.create` 호출. 프롬프트: 빌드 로그 → BuildError[] JSON 반환 요청.

```typescript
// BuildError — 모든 에러 발행에서 사용하는 공통 타입
interface BuildError {
  file?: string       // 오류 발생 파일 경로 (없을 수 있음)
  line?: number       // 오류 발생 줄 번호 (없을 수 있음)
  message: string     // 오류 메시지 (필수)
  suggestion: string  // Claude가 생성한 수정 제안 (필수, 분석 전에는 초기값)
}
```

---

## 에러 처리 흐름

```
빌드 실행
    │
    ├─ exitCode === 0 ──────────────────→ build_complete (success: true)
    │
    └─ exitCode !== 0
            │
            ├─ claude/runner.ts 호출
            │       │
            │       ├─ 분석 성공 → BuildError[] 포함 build_complete (success: false)
            │       │
            │       └─ 분석 실패 (SDK 오류 등)
            │               │
            │               └─ errors: [{ message: output, suggestion: 'Claude 분석 실패' }]
            │                  로 fallback → build_complete (success: false)
            │
            └─ 타임아웃 (BUILD_TIMEOUT_MS 초과)
                    │
                    └─ 프로세스 kill → error 메시지 발행
```

---

## 세션 생명주기

```
Redis Consumer Group 'builder-consumers'
    │
    ├─ XREADGROUP (block 0) 대기
    │
    ├─ build_request 수신
    │       │
    │       ├─ builder.ts 호출 (비동기)
    │       │
    │       └─ XACK → 메시지 처리 완료 마킹
    │               (빌드 완료 후가 아닌 수신 즉시 ACK)
    │
    └─ abort 수신
            │
            └─ 진행 중 child_process.kill('SIGTERM')
```

> **주의:** abort는 현재 실행 중인 세션과 sessionId가 일치할 때만 처리.

---

## WORKSPACE_ROOT 경로 검증

`executor.ts`가 실행 전 수행. 심볼릭 링크를 통한 우회를 막으려면 `path.resolve` 대신 `fs.realpath`로 실제 경로를 얻은 후 비교해야 한다.

```
projectPath 수신
    │
    ├─ path.resolve(projectPath).startsWith(path.resolve(WORKSPACE_ROOT))
    │       │
    │       ├─ true → 빌드 실행
    │       │
    │       └─ false → Error 즉시 throw → error 메시지 발행, 빌드 미실행
    │
    └─ projectPath가 존재하지 않는 경로
            │
            └─ fs.access 실패 → Error throw
```
