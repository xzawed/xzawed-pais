# xzawedBuilder 기본 문서 세트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code가 새 세션에서 읽고 즉시 구현을 시작할 수 있는 Claude-first 문서 세트 6개 파일을 생성한다.

**Architecture:** 각 파일은 단일 역할만 담당한다. README는 진입점(셋업), CONTRIBUTING은 코딩 규칙, docs/architecture.md는 인터페이스 계약과 에러 흐름, .env.example은 환경변수 명세, .gitignore는 제외 파일 목록, specs는 설계 원본이다.

**Tech Stack:** Markdown, YAML frontmatter (없음), 순수 텍스트

---

## 파일 맵

| 생성 | 경로 | 역할 |
|---|---|---|
| 신규 | `README.md` | 진입점: 전제조건 + 셋업 체크리스트 |
| 신규 | `.env.example` | 환경변수 전체 명세 |
| 신규 | `.gitignore` | Node.js/TS 제외 목록 |
| 신규 | `CONTRIBUTING.md` | Claude용 코딩 컨벤션 |
| 신규 | `docs/architecture.md` | 컴포넌트 계약 + 에러 흐름 |
| 이동+정제 | `docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md` | 기존 spec 이동 |

---

### Task 1: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: README.md 작성**

```markdown
# xzawedBuilder

xzawed 멀티 에이전트 시스템의 빌드 에이전트. xzawedManager(포트 3001)로부터 빌드 요청을 받아 실행하고 결과를 반환한다.

## 전제조건

- [ ] Node.js 20+
- [ ] pnpm (`npm install -g pnpm`)
- [ ] Redis 실행 중 (`redis-server` 또는 Docker)
- [ ] `ANTHROPIC_API_KEY` 보유

## 셋업

\```bash
pnpm install
cp .env.example .env
# .env 열어 ANTHROPIC_API_KEY, WORKSPACE_ROOT 편집
pnpm dev
\```

헬스체크: `curl http://localhost:3006/health`

## 명령어

| 명령어 | 설명 |
|---|---|
| `pnpm dev` | tsx watch 개발 모드 |
| `pnpm build` | TypeScript 컴파일 → dist/ |
| `pnpm test` | Vitest 전체 실행 |
| `pnpm test <파일>` | 단일 파일 테스트 |

## 관련 서비스

| 서비스 | 포트 | 역할 |
|---|---|---|
| xzawedOrchestrator | 3000 | 프로젝트 지휘자 |
| xzawedManager | 3001 | 총관리자 (빌드 요청 발신) |
| xzawedBuilder | 3006 | 이 서비스 |

## 문서

- [아키텍처](docs/architecture.md)
- [설계 스펙](docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md)
- [Claude 가이드](CLAUDE.md)
```

- [ ] **Step 2: 필수 섹션 검증**

다음이 모두 포함됐는지 확인:
  - 전제조건 체크리스트 4개
  - 셋업 코드 블록 (cp .env.example 포함)
  - 명령어 표
  - 관련 서비스 포트 표

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs: add README with setup checklist and service map"
```

---

### Task 2: .env.example

**Files:**
- Create: `.env.example`

- [ ] **Step 1: .env.example 작성**

```bash
# ────────────────────────────────
# Anthropic
# ────────────────────────────────

# Claude API 키 (필수)
ANTHROPIC_API_KEY=sk-ant-...

# 사용 모델 (claude-sonnet-4-6 | claude-haiku-4-5-20251001 | claude-opus-4-7)
CLAUDE_MODEL=claude-sonnet-4-6

# ────────────────────────────────
# Redis
# ────────────────────────────────

# Redis 연결 URL (필수)
REDIS_URL=redis://localhost:6379

# ────────────────────────────────
# 서버
# ────────────────────────────────

# HTTP 헬스체크 포트 (기본값: 3006)
PORT=3006

# 배포 모드 (local | remote)
MODE=local

# ────────────────────────────────
# 빌드 보안
# ────────────────────────────────

# 빌드 허용 루트 경로 — 이 경로 외부 빌드는 거부됨 (필수)
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE

# 빌드 타임아웃 (밀리초, 기본값: 120000 = 2분)
BUILD_TIMEOUT_MS=120000
```

- [ ] **Step 2: 검증**

모든 변수가 `config.ts`에서 참조될 7개 항목과 일치하는지 확인:
`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `REDIS_URL`, `PORT`, `MODE`, `WORKSPACE_ROOT`, `BUILD_TIMEOUT_MS`

- [ ] **Step 3: 커밋**

```bash
git add .env.example
git commit -m "docs: add .env.example with all config variables annotated"
```

---

### Task 3: .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: .gitignore 작성**

```gitignore
# 의존성
node_modules/

# 빌드 출력
dist/
build/
*.js.map
*.tsbuildinfo

# 환경변수
.env
.env.local
.env.*.local

# 빌드 프로세스 출력
build-output/

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# 로그
*.log
logs/

# 테스트 커버리지
coverage/
```

- [ ] **Step 2: 커밋**

```bash
git add .gitignore
git commit -m "chore: add .gitignore for Node.js/TypeScript project"
```

---

### Task 4: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: CONTRIBUTING.md 작성**

```markdown
# 코딩 컨벤션

이 문서는 Claude Code가 xzawedBuilder 코드를 작성할 때 따르는 규칙이다.

## 파일 책임 원칙

각 파일은 하나의 역할만 담당한다.

| 파일 | 허용 | 금지 |
|---|---|---|
| `detector.ts` | 빌드 명령 감지 | child_process 실행 |
| `executor.ts` | child_process 실행 + 스트리밍 | Redis 발행 |
| `builder.ts` | 감지·실행 조율 | 직접 Redis 접근 |
| `streams/producer.ts` | Redis 메시지 발행 | 빌드 로직 |
| `claude/runner.ts` | Anthropic SDK 호출 | 파일시스템 접근 |

## 에러 처리 규칙

빌드 실패는 반드시 `BuildError` 타입으로 변환해 발행한다. 원시 `Error` 객체를 Redis에 직접 발행하지 않는다.

```typescript
// ✅ 올바름
const errors: BuildError[] = [
  { file: 'src/index.ts', line: 12, message: e.message, suggestion: '' }
]

// ❌ 금지
producer.publish({ error: new Error('build failed') })
```

## Redis 메시지 발행 규칙

`producer.ts`를 통해서만 발행한다. 발행 전 반드시 Zod 스키마로 검증한다.

```typescript
// ✅ 올바름
const validated = BuilderToManagerMessageSchema.parse(message)
await producer.publish(sessionId, validated)

// ❌ 금지
await redis.xadd(stream, '*', 'data', JSON.stringify(rawMessage))
```

## 스트리밍 출력 규칙

`executor.ts`는 stdout/stderr를 청크 단위로 수신하는 즉시 `build_progress` 메시지로 발행한다. 전체 출력을 버퍼에 쌓아 한 번에 발행하지 않는다.

```typescript
// ✅ 올바름
proc.stdout.on('data', (chunk) => {
  producer.publish(sessionId, { type: 'build_progress', payload: { content: chunk.toString() } })
})

// ❌ 금지
let output = ''
proc.stdout.on('data', (chunk) => { output += chunk })
proc.on('close', () => producer.publish(sessionId, { payload: { output } }))
```

## 경로 보안 규칙

`executor.ts`는 빌드 실행 전 `projectPath`가 `WORKSPACE_ROOT` 하위인지 반드시 검증한다.

```typescript
import path from 'node:path'

if (!path.resolve(projectPath).startsWith(path.resolve(config.workspaceRoot))) {
  throw new Error(`경로 거부: ${projectPath}`)
}
```

## 테스트 기준

| 대상 | 종류 | 위치 |
|---|---|---|
| `detector.ts` | 단위 테스트 (파일시스템 mock) | `src/detector.test.ts` |
| `executor.ts` | 단위 테스트 (child_process mock) | `src/executor.test.ts` |
| `builder.ts` | 단위 테스트 (detector·executor mock) | `src/builder.test.ts` |
| `streams/` | 통합 테스트 (실제 Redis) | `src/streams/consumer.test.ts` |
```

- [ ] **Step 2: 검증**

다음 규칙이 모두 포함됐는지 확인:
  - 파일 책임 원칙 표
  - BuildError 사용 예시
  - Zod 검증 예시
  - 스트리밍 규칙 예시
  - 경로 보안 규칙
  - 테스트 기준 표

- [ ] **Step 3: 커밋**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING with coding conventions for Claude Code"
```

---

### Task 5: docs/architecture.md

**Files:**
- Create: `docs/architecture.md`

- [ ] **Step 1: docs/architecture.md 작성**

```markdown
# 아키텍처

## 컴포넌트 인터페이스 계약

### detector.ts

```typescript
// 입력: 프로젝트 루트 경로
// 출력: 실행할 빌드 명령 문자열
async function detectBuildCommand(projectPath: string): Promise<string>
```

감지 순서 (우선순위):
1. `package.json` 존재 → scripts.build 값 → `pnpm run build`
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

`executor.ts`가 실행 전 수행. `path.resolve`로 심볼릭 링크 해소 후 비교.

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
```

- [ ] **Step 2: 검증**

다음 항목이 모두 포함됐는지 확인:
  - detector 인터페이스 + 감지 우선순위 4단계
  - executor 인터페이스 (onChunk 포함)
  - claude/runner 인터페이스
  - 에러 처리 흐름도 (타임아웃 경로 포함)
  - 세션 생명주기 (ACK 타이밍 명시)
  - 경로 검증 흐름도

- [ ] **Step 3: 커밋**

```bash
git add docs/architecture.md
git commit -m "docs: add architecture.md with component contracts and error flows"
```

---

### Task 6: 스펙 파일 이동 및 정제

**Files:**
- Create: `docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md`
- Delete: `xzawedBuilder-spec.md` (내용 이동 후)

- [ ] **Step 1: 기존 스펙 파일 내용을 새 경로에 복사**

`xzawedBuilder-spec.md`의 내용을 `docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md`로 이동.

헤더를 다음으로 교체:
```markdown
# xzawedBuilder 설계 스펙

날짜: 2026-05-15  
버전: 1.0  
상태: 확정
```

기존 `# CLAUDE.md — xzawedBuilder` 헤더 제거 (CLAUDE.md는 별도 파일로 분리됨).

- [ ] **Step 2: 원본 파일 삭제**

```bash
# PowerShell
Remove-Item "xzawedBuilder-spec.md"
```

- [ ] **Step 3: CLAUDE.md의 스펙 참조 경로 업데이트**

`CLAUDE.md`에 스펙 파일 경로 참조가 있다면 새 경로로 변경:
```
docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md CLAUDE.md
git rm xzawedBuilder-spec.md
git commit -m "docs: move spec to docs/superpowers/specs/ and update CLAUDE.md reference"
```

---

## 완료 기준

모든 태스크 완료 후 다음을 확인:

```bash
# 파일 구조 확인
ls README.md .env.example .gitignore CONTRIBUTING.md
ls docs/architecture.md
ls docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md

# xzawedBuilder-spec.md 삭제 확인
ls xzawedBuilder-spec.md   # "No such file" 이어야 함
```
