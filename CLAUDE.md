# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 플랫폼 개요

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획 → 개발 → 디자인 → 테스트 → 빌드 → 모니터링을 자동으로 수행한다.

**모든 서비스는 이 단일 저장소에서 관리된다.** 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

전체 API·가이드·설계 스펙은 [`docs/`](docs/README.md)를 참고한다.

## 서비스 전체 현황

| 서비스 | 포트 | 상태 | 역할 | 상세 |
|---|---|---|---|---|
| xzawedOrchestrator | 3000 | ✅ 271/271 | 사용자 지시 수신·정제 후 Manager에 전달; GitHub·MCP·Plugin 통합 Electron UI; 인증(JWT·Rate Limit·Refresh) | [CLAUDE.md](xzawedOrchestrator/CLAUDE.md) |
| xzawedManager | 3001 | ✅ 143/143 | Claude tool-calling 루프, 하위 에이전트 디스패치; github-ops ToolHandler | [CLAUDE.md](xzawedManager/CLAUDE.md) |
| xzawedShared | — | ✅ 32/32 | 에이전트 서비스 공통 BaseConsumer + validateWorkspaceRoot + resolveWorkspaceRoot + SessionDispatcher 라이브러리 (@xzawed/agent-streams) | [CLAUDE.md](xzawedShared/CLAUDE.md) |
| xzawedPlanner | 3002 | ✅ 39/39 | intent → 실행 가능한 Step[] 분해 | [CLAUDE.md](xzawedPlanner/CLAUDE.md) |
| xzawedDeveloper | 3003 | ✅ 48/48 | 코드 생성·수정, 파일 I/O | [CLAUDE.md](xzawedDeveloper/CLAUDE.md) |
| xzawedDesigner | 3004 | ✅ 33/33 | UI 컴포넌트 스펙 설계 | [CLAUDE.md](xzawedDesigner/CLAUDE.md) |
| xzawedTester | 3005 | ✅ 53/53 | 테스트 실행·분석 | [CLAUDE.md](xzawedTester/CLAUDE.md) |
| xzawedBuilder | 3006 | ✅ 62/62 | 프로젝트 빌드 감지·실행 | [CLAUDE.md](xzawedBuilder/CLAUDE.md) |
| xzawedWatcher | 3007 | ✅ 47/47 | 파일 변경 감시·이벤트 스트리밍 | [CLAUDE.md](xzawedWatcher/CLAUDE.md) |
| xzawedSecurity | 3008 | ✅ 67/67 | OWASP 보안 감사 | [CLAUDE.md](xzawedSecurity/CLAUDE.md) |

## 공통 기술 스택

TypeScript 5 (strict mode) 공통 적용. 모든 서비스가 사용:

- **Fastify 5** — HTTP 서버 (`/health` 엔드포인트)
- **ioredis** — Redis Streams 소비자/생산자
- **Zod** — 환경변수 검증 및 스키마
- **@anthropic-ai/sdk** — Claude API 호출
- **Vitest 3** — 테스트 (`pool: 'forks'`, 프로세스 격리; Turborepo 패키지는 기본 설정 사용)
- **pnpm** — 패키지 매니저 (npm/yarn 사용 금지)

xzawedOrchestrator 추가: **@modelcontextprotocol/sdk** (MCP 서버), **React 19 + Zustand + Electron** (데스크톱 UI), **Turborepo** (xzawedOrchestrator·xzawedManager 모노레포), **@octokit/rest** (xzawedManager GitHub API).

xzawedOrchestrator Electron 앱 추가: GitHub OAuth 통합, McpProcessManager (child_process.spawn), PluginManager (Claude Code / xzawed 확장 관리), Zustand integrations.store, **Tailwind CSS v4** (디자인 토큰), **shadcn/ui** (Button·Badge·Dialog·Command 등), **Framer Motion** (UI 애니메이션), **Shiki** (코드 하이라이팅), **cmdk** (⌘K Command Palette), **sonner** (토스트).

## 테스트 패턴

### 블로킹 I/O Mock

Redis `XREADGROUP BLOCK` 등 블로킹 I/O를 mock할 때 즉시 resolve하면 macrotask 큐가 차단되어 OOM이 발생한다.
반드시 `setImmediate`로 macrotask 양보를 재현한다.

```typescript
// ❌ 마이크로태스크 루프 유발 — setTimeout이 실행되지 않아 stop()이 호출 불가
xreadgroup: vi.fn().mockResolvedValue(null)

// ✅ 올바른 패턴 — macrotask로 이벤트 루프 양보
xreadgroup: vi.fn().mockImplementation(
  () => new Promise<null>(r => setImmediate(() => r(null)))
)
```

### ioredis 테스트 환경 설정

Redis가 없는 테스트 환경에서 ioredis의 기본 무한 재연결이 이벤트 루프를 활성 상태로 유지한다.
모든 redis.client.ts에 적용:

```typescript
client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 2000,
  retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined,
})
```

### vitest Shard Coverage 병합

vitest 3.x에 `merge-coverage` 서브커맨드가 없다. shard별 `lcov.info`를 직접 병합한다:

```bash
# CI에서 shard 1/2, 2/2 실행 후
mkdir -p coverage
cat coverage/shard-*/lcov.info > coverage/lcov.info
```

## 공통 명령어 패턴

### Turborepo 기반 (xzawedOrchestrator, xzawedManager)

```bash
pnpm install
pnpm build                              # 전체 빌드
pnpm test                               # 전체 테스트
cd packages/server && pnpm dev          # 서버 개발 모드
cd packages/server && pnpm test <파일>  # 단일 테스트 파일
```

### 독립 서비스 (그 외 모든 에이전트)

> **⚠️ 사전 빌드 필수**: 독립 에이전트 서비스 테스트 실행 전 xzawedShared를 먼저 빌드해야 한다.
> ```bash
> cd xzawedShared && pnpm install && pnpm build && cd ..
> ```

```bash
pnpm install
pnpm dev               # tsx watch 개발 모드
pnpm test              # Vitest 전체 실행
pnpm test <파일>       # 단일 테스트 파일
pnpm build             # TypeScript 컴파일 → dist/
```

## Redis Streams 통신 구조

스트림 키 규칙:

```
{출발지}:to-{목적지}:{sessionId}   →   소비자 그룹: {목적지}-consumers
```

실제 예: `orchestrator:to-manager:{sessionId}`, `manager:to-planner:{sessionId}`, `{agent}:to-manager:{sessionId}` 등. 모든 에이전트는 `manager:to-{agent}:{sessionId}` 수신 → `{agent}:to-manager:{sessionId}` 응답 패턴을 따른다.

모든 메시지 공통 구조:

```typescript
{
  sessionId: string
  messageId: string
  timestamp: number
  type: string      // 서비스별 정의
  payload: object   // 서비스별 정의
}
```

## 공통 환경 변수

모든 서비스의 `.env.example`을 `.env`로 복사 후 실행.

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<서비스별 포트>
MODE=local
```

> **예외**: xzawedWatcher는 Claude API를 사용하지 않으므로 ANTHROPIC_API_KEY / CLAUDE_MODEL 불필요.

서비스별 추가 환경 변수, 메시지 인터페이스, 아키텍처 세부 사항은 각 서비스 디렉토리의 `CLAUDE.md`를 참고한다.

## 개발 워크플로우

**모든 작업은 Pull Request(PR)를 통해 진행한다.**

```
feature/fix 브랜치 생성 → 작업 → 테스트 통과 → 코드 검토 → PR 생성 → 머지
```

### 규칙

1. `master`에 직접 push 금지 — 반드시 브랜치를 만들어 작업한다
   > master 직접 커밋 시 SonarCloud "New Code" 계산 기준이 꼬여 소급 PR로도 CPD 통과가 어려워진다
2. PR은 작업 완료 후 마지막에 생성한다 (Draft PR 방식 사용 금지)
3. PR 생성 전 필수 조건:
   - 해당 서비스의 테스트 전체 통과 (`pnpm test`)
   - **빌드 성공 (`pnpm build`) — tsc 타입 체크 포함, 테스트 파일도 검사**
   - `pnpm audit` 취약점 0개
   - CPD 로컬 확인: `npx jscpd@3.5.10 --config .jscpd.json` (0 clones 목표)

### 장기 디버깅 시 컨텍스트 관리

같은 실패를 3회 이상 반복할 경우, 계속 진행하기 전에 다음을 먼저 정리한다:

```
시도한 것: [목록]
각 시도가 실패한 이유: [목록]
아직 확인하지 못한 가설: [목록]
```

이 요약 없이 계속하면 이미 실패한 접근법을 반복하게 된다. CI 로그·대시보드·외부 도구(jscpd 리포트, SonarCloud API 댓글)의 실제 출력을 코드 추론보다 우선한다.

### 브랜치 네이밍

```
feat/<서비스>/<설명>   # 새 기능
fix/<서비스>/<설명>    # 버그 수정
docs/<설명>            # 문서만 변경
chore/<설명>           # 의존성, 설정 변경
```

예: `feat/developer/file-diff-support`, `fix/security/static-analyzer-false-positive`

## 보안 아키텍처 원칙

PR #9(2026-05-17) 전체 보안 감사를 통해 수립된 공통 보안 패턴.

### 명령 실행 (Builder, Tester)
- `spawn(cmd, [], {shell:true})` **금지** — 반드시 `spawn(bin, args, {shell:false})` 사용
- Redis 페이로드의 커맨드 필드는 allowlist 검증 필수 (`ALLOWED_PREFIXES`)
- `package.json scripts` 값은 신뢰하지 않음 — 의존성 기반 하드코딩 명령어만 사용

### Redis 메시지 검증
- 모든 Redis 수신 메시지는 `safeParse`(Zod) 로 런타임 검증 후 처리
- 검증 실패 시 `xack` 후 skip (프로세스 중단 금지)

### 경로 검증
- `WORKSPACE_ROOT`가 파일시스템 루트(`/`, `C:\`)이면 시작 시 거부 — `validateWorkspaceRoot(workspaceRoot)` (from `@xzawed/agent-streams`) 호출로 통일
- LLM 생성 경로는 절대경로 허용 금지 — `workspaceRoot` 기준 상대경로로 강제
- `triggers` 등 외부 입력 glob은 절대경로·`..` 포함 시 Zod 단계에서 차단

### 인증
- `SERVICE_JWT_SECRET`은 `AUTH=jwt` 시 32자 이상 필수 (`superRefine` 강제)
- OAuth 플로우에는 반드시 `state` 파라미터 생성·검증 (CSRF 방지)

### Electron IPC
- 민감 자격증명(토큰, 키)은 렌더러에 노출 금지 — main 프로세스에서 직접 API 호출
- MCP `args`는 런타임별 위험 플래그(`-e`, `-c`, `--eval`, URL) 차단
- `electron.d.ts`에 `Window` 인터페이스 + `var electronAPI` 전역 선언 모두 필요 — 렌더러 컴포넌트가 `globalThis.electronAPI`로 접근 시 타입 추론을 위해 (`interface Window`만으로는 `typeof globalThis` 인덱스 미반영)

### SSRF / Open Redirect 방지
- `fetch` URL은 반드시 `new URL(url)` 파싱 후 `protocol`이 `http:` 또는 `https:`임을 검증 (http-remote-runner.ts, manager.client.ts)
- `shell.openExternal` 호출 전 URL 접두사 검증 필수 — 예상 접두사가 아니면 즉시 에러 (github-oauth-handler.ts)

### Redis 안정성
- `handler(msg)` 호출은 반드시 `try/finally`로 감싸 `xack` 보장 — 핸들러 예외 시 PEL 누수 방지
- `JSON.parse` + `onMessage` 모두 `try/catch/finally`로 감싸 메시지 처리 실패 시에도 `xack` 실행

### Dockerfile 보안 (SonarCloud 규칙 준수)
새 Dockerfile 작성 또는 기존 Dockerfile 수정 시 아래 항목을 반드시 확인한다.

- **`docker:S6501` — runner 스테이지에 `USER node` 필수**: 컨테이너가 root로 실행되면 SonarCloud가 Security Hotspot으로 탐지. `EXPOSE` 다음 줄, `CMD` 바로 앞에 추가.
  ```dockerfile
  EXPOSE 3XXX
  USER node
  CMD ["node", "dist/index.js"]
  ```
- **`docker:S6505` — `pnpm install`에 `--ignore-scripts` 필수**: 모든 `RUN pnpm install` 명령에 `--ignore-scripts` 포함. 순수 JS 의존성만 사용하는 한 동작에 영향 없음.
  ```dockerfile
  RUN pnpm install --frozen-lockfile --ignore-scripts
  ```
- **Dockerfile을 완전 재작성하면 모든 줄이 "신규 코드"**: SonarCloud PR 분석은 PR diff의 추가·변경된 줄만 신규 코드로 계산. Dockerfile 전체를 재작성한 경우 위 두 규칙 위반이 모두 신규 핫스팟으로 탐지됨.

### 전이 의존성 취약점 (pnpm overrides)
직접 의존성이 아닌 전이 의존성 취약점은 `pnpm audit`이 잡지만 `pnpm update`로 해결되지 않는다.
루트 `package.json`에 `pnpm.overrides`로 강제 해결:

```json
"pnpm": {
  "overrides": {
    "취약한-패키지": ">=안전한-버전"
  }
}
```

적용 후 `pnpm install` 실행으로 lock 파일 업데이트 필수.

### 브랜치 의존성 관리
같은 파일을 병렬 브랜치에서 수정하면 merge conflict가 발생한다.

- **순차 의존 관계**: 선행 PR 머지 확인 후 후행 브랜치 분기
- **병렬 작업 중 master 머지 발생 시**: 즉시 `git merge origin/master` 실행 후 충돌 해결
- **PR 설명에 명시**: "이 PR은 #N 머지 후 리뷰 요망" (의존 관계 있을 때)

## SonarCloud 트러블슈팅

상세 가이드: [docs/development/sonarcloud.md](docs/development/sonarcloud.md)

**빠른 참조**:
- CPD 실패 → `npx jscpd@3.5.10 --config .jscpd.json` 로컬 확인 먼저
- 핫스팟 규칙 ID 확인 → SonarCloud PR 댓글 링크 → Security Hotspots 탭
- Dockerfile → `USER node`(S6501), `--ignore-scripts`(S6505) 필수

## 인프라

- **Docker**: `docker-compose.yml` — Redis + 9개 서비스 전체 실행. 모든 서비스 `context: .` (프로젝트 루트) + `dockerfile: <서비스>/Dockerfile` 패턴. xzawedOrchestrator·xzawedManager는 각각 `Dockerfile.dockerignore`로 빌드 격리. developer·tester·builder·watcher·security에 `WORKSPACE_ROOT: /workspace` 주입, orchestrator에 `MANAGER_URL: http://manager:3001` 주입.
- **CI/CD**: `.github/workflows/ci.yml` — PR마다 9개 서비스 병렬 빌드·테스트·감사 자동 실행. `redis-integration` 잡(Redis 서비스 컨테이너), `playwright-e2e` 잡(Electron E2E, xvfb-run), `all-checks-pass` 게이트 포함. PR 전용으로 jscpd(중복 파일·줄 번호) + SonarCloud API 폴링(품질 게이트·파일별 밀도) 댓글 자동 게시.
- **Dependabot**: `.github/dependabot.yml` — 9개 서비스 + GitHub Actions 주간 의존성 업데이트.
