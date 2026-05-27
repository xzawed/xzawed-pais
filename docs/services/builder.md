# xzawedBuilder — 빌드 에이전트

xzawedManager로부터 프로젝트 경로와 빌드 타깃을 받아 빌드를 실행하고 결과 아티팩트를 반환한다. 빌드 실패 시 Claude로 오류를 분석해 수정 제안을 생성한다.

**포트:** 3006 | **상태:** 구현 완료 (49/49 테스트)

---

## Overview

xzawedBuilder는 다중 언어 빌드 시스템을 지원한다. `detector.ts`가 `projectPath`부터 `workspaceRoot`까지 부모 디렉토리를 탐색하며 빌드 파일(`Cargo.toml`, `Makefile`, `package.json`, `go.mod`)을 찾아 안전한 하드코딩 명령어를 반환한다. `builder.ts`는 빌드 전 `packageManager` 필드 제거와 의존성 사전 설치(`runPreInstall`)를 수행한다. 빌드 진행 중 stdout/stderr 청크를 즉시 `build_progress`로 스트리밍한다.

**입력:** `manager:to-builder:{sessionId}` 스트림의 `build_request` 메시지  
**출력:** `builder:to-manager:{sessionId}` 스트림의 `build_complete`, `build_progress`, 또는 `error` 메시지

---

## Redis Streams 인터페이스

**Consumer Group:** `builder-consumers`

### 수신 (ManagerToBuilderMessage)

```typescript
interface ManagerToBuilderMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_request' | 'abort'
  payload: {
    projectPath: string
    target: 'development' | 'production'
    command?: string              // 없으면 의존성 기반 자동 감지
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

### 발신 (BuilderToManagerMessage)

```typescript
interface BuilderToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
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

interface BuildError {
  file?: string                   // 오류 발생 파일 (없을 수 있음)
  line?: number                   // 오류 발생 줄 번호 (없을 수 있음)
  message: string
  suggestion: string              // Claude가 생성한 수정 제안
}
```

---

## Architecture

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner 초기화
├── config.ts             # 환경변수 검증 (Zod) — workspaceRoot, buildTimeoutMs 포함
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3006)
├── builder.ts            # 빌드 조율 — validateBuildCommand(), stripPackageManagerField(), runPreInstall()
├── detector.ts           # 빌드 명령 자동 감지 — projectPath→workspaceRoot 상향 탐색 (detectBuildInfo)
├── executor.ts           # spawn(shell:false) 실행; validatePath() — WORKSPACE_ROOT 검증
├── types.ts              # BuildError, ManagerToBuilderMessageSchema, BuilderToManagerMessage 정의
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-builder:{sessionId} 구독
│   └── producer.ts       # builder:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts         # Anthropic SDK — 빌드 로그 → BuildError[] 분석
```

### 데이터 흐름

1. `consumer.ts` → `build_request` 수신, Zod 스키마 검증
2. `builder.ts` → `validatePath()`로 경로 검증
3. `payload.command`가 있으면 `validateBuildCommand()`로 allowlist 확인, 없으면 `detectBuildInfo()`로 자동 감지
4. `stripPackageManagerField()` — `package.json`의 `packageManager` 필드 제거 (corepack 충돌 방지)
5. `runPreInstall()` — `node_modules` 없으면 `pnpm install` 또는 `npm install` 실행
6. `executor.ts` → `spawn(bin, args, {shell:false})` 실행, 청크 즉시 `build_progress`로 발행
7. 실패 시 `claude/runner.ts` → `BuildError[]` 생성
8. `producer.ts` → `build_complete` 발행

### 빌드 명령 감지 우선순위

`detectBuildInfo()`는 `projectPath`에서 `workspaceRoot`까지 상향 탐색하며 아래 순서로 감지한다:

1. `Cargo.toml` → `cargo build --release`
2. `Makefile` → `make build`
3. `package.json` (의존성 기반) → `pnpm run build` (`scripts.build` 값 미사용)
4. `go.mod` → `go build ./...`
5. 미감지 → `Error('빌드 명령을 감지할 수 없음')`

### 에러 처리 흐름

```
빌드 실행
    ├─ exitCode === 0 ──→ build_complete (success: true)
    └─ exitCode !== 0
            ├─ claude/runner.ts 호출 성공 → BuildError[] 포함 build_complete (success: false)
            ├─ claude/runner.ts 실패 → fallback errors → build_complete (success: false)
            └─ BUILD_TIMEOUT_MS 초과 → SIGTERM → error 메시지 발행
```

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3006` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 (`local` \| `remote`) |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |
| `BUILD_TIMEOUT_MS` | 선택 | `120000` | 빌드 프로세스 타임아웃 (ms) |

---

## Development

```bash
# 의존성 설치 (xzawedShared 먼저 빌드 필수)
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedBuilder
pnpm install

pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 실행
pnpm test <파일>   # 단일 파일
pnpm build         # TypeScript 컴파일 → dist/
```

### 구현 참고사항

- `validateBuildCommand()`: `ALLOWED_PREFIXES`(`pnpm`, `npm`, `npx`, `yarn`, `cargo build`, `make`, `cmake`, `gradle`, `mvn`, `go build`, `tsc`, `webpack`, `vite build`) + 셸 메타문자 이중 차단
- `stripPackageManagerField()`: Corepack의 엄격 모드 충돌 방지를 위해 빌드 전 `package.json`에서 `packageManager` 필드 제거
- `runPreInstall()`: `node_modules` 없을 때만 실행; `pnpm-lock.yaml` 존재하면 `pnpm install`, 없으면 `npm install`
- `executor.ts`의 빈 명령어 가드: `bin`이 비어있으면 즉시 `throw`

---

## Related

- [xzawedShared CLAUDE.md](../../xzawedShared/CLAUDE.md) — BaseConsumer, validateWorkspaceRoot
- [xzawedManager tools/build-project.ts](../../xzawedManager/packages/server/src/tools/build-project.ts)
- [서비스 목록](../README.md)

