# CLAUDE.md — xzawedBuilder

## 프로젝트 개요

xzawedBuilder는 xzawed 멀티 에이전트 시스템의 **빌드 에이전트**다.
xzawedManager로부터 프로젝트 경로와 빌드 타깃을 받아 빌드를 실행하고 결과 아티팩트를 반환한다.

**현재 상태: 구현 완료 (140/140 테스트 통과)**

## 핵심 명령어

```bash
# xzawedShared 먼저 빌드 필수
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedBuilder

pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <파일>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일 → dist/
```

## 디렉토리 구조

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner 초기화
├── config.ts             # 환경변수 검증 (Zod) — workspaceRoot, buildTimeoutMs 포함
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3006)
├── builder.ts            # 빌드 조율 — validateBuildCommand(), stripPackageManagerField(), runPreInstall()
├── detector.ts           # 빌드 명령 감지 — projectPath→workspaceRoot 상향 탐색 (detectBuildInfo)
├── executor.ts           # spawn(shell:false) 실행; validatePath() — WORKSPACE_ROOT 검증
├── types.ts              # BuildError, ManagerToBuilderMessageSchema, BuilderToManagerMessage
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-builder:{sessionId}
│   ├── consumer.test.ts
│   ├── producer.ts       # builder:to-manager:{sessionId} 발행
│   └── producer.test.ts
└── claude/
    └── runner.ts         # Anthropic SDK — 빌드 로그 → BuildError[] 분석
```

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

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3006` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |
| `BUILD_TIMEOUT_MS` | 선택 | `120000` | 빌드 타임아웃 (ms) |

## 구현 참고사항

**보안 패턴**
- `validateBuildCommand()`: `ALLOWED_PREFIXES`(`pnpm`, `npm`, `npx`, `yarn`, `cargo build`, `make`, `cmake`, `gradle`, `mvn`, `go build`, `tsc`, `webpack`, `vite build`) + 셸 메타문자 이중 차단
- `detector.ts`: `package.json scripts.build`는 신뢰하지 않음 — 의존성 기반 하드코딩 명령어만 반환
- `executor.ts`: `spawn(bin, args, {shell:false})` 고정. `bin`이 빈 문자열이면 즉시 throw
- `validatePath()`: `validateWorkspaceRoot()` 후 `fs.realpath`로 심볼릭 링크 우회 차단

**전처리 단계 (builder.ts)**
- `stripPackageManagerField()`: Corepack 충돌 방지를 위해 빌드 전 `package.json`의 `packageManager` 필드 제거
- `runPreInstall()`: `node_modules` 없을 때만 실행; `pnpm-lock.yaml` 있으면 `pnpm install`, 없으면 `npm install`

**빌드 명령 감지 (detector.ts)**
- `detectBuildInfo()`: `projectPath`에서 `workspaceRoot`까지 상향 탐색 → Cargo.toml → Makefile → package.json → go.mod 순서

**스트리밍:** stdout/stderr 청크를 즉시 `build_progress`로 발행 (버퍼링 없음)

**협업 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변(답변자 역할 — 교차질의 개시·지식 emit은 없음)

**아키텍처 상세:** `docs/services/builder-architecture.md`

**Manager 연결:** `xzawedManager/packages/server/src/tools/build-project.ts` (`createBuildProjectHandler`)
