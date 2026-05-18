# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 플랫폼 개요

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획 → 개발 → 디자인 → 테스트 → 빌드 → 모니터링을 자동으로 수행한다.

**모든 서비스는 이 단일 저장소에서 관리된다.** 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

전체 API·가이드·설계 스펙은 [`docs/`](docs/README.md)를 참고한다.

## 서비스 전체 현황

| 서비스 | 포트 | 상태 | 역할 | 상세 |
|---|---|---|---|---|
| xzawedOrchestrator | 3000 | ✅ 120/120 | 사용자 지시 수신·정제 후 Manager에 전달; GitHub·MCP·Plugin 통합 Electron UI | [CLAUDE.md](xzawedOrchestrator/CLAUDE.md) |
| xzawedManager | 3001 | ✅ 67/67 | Claude tool-calling 루프, 하위 에이전트 디스패치; github-ops ToolHandler | [CLAUDE.md](xzawedManager/CLAUDE.md) |
| xzawedShared | — | ✅ | 에이전트 서비스 공통 BaseConsumer 라이브러리 (@xzawed/agent-streams) | [CLAUDE.md](xzawedShared/CLAUDE.md) |
| xzawedPlanner | 3002 | ✅ 33/33 | intent → 실행 가능한 Step[] 분해 | [CLAUDE.md](xzawedPlanner/CLAUDE.md) |
| xzawedDeveloper | 3003 | ✅ 31/31 | 코드 생성·수정, 파일 I/O | [CLAUDE.md](xzawedDeveloper/CLAUDE.md) |
| xzawedDesigner | 3004 | ✅ 26/26 | UI 컴포넌트 스펙 설계 | [CLAUDE.md](xzawedDesigner/CLAUDE.md) |
| xzawedTester | 3005 | ✅ 28/28 | 테스트 실행·분석 | [CLAUDE.md](xzawedTester/CLAUDE.md) |
| xzawedBuilder | 3006 | ✅ 39/39 | 프로젝트 빌드 감지·실행 | [CLAUDE.md](xzawedBuilder/CLAUDE.md) |
| xzawedWatcher | 3007 | ✅ 26/26 | 파일 변경 감시·이벤트 스트리밍 | [CLAUDE.md](xzawedWatcher/CLAUDE.md) |
| xzawedSecurity | 3008 | ✅ 45/45 | OWASP 보안 감사 | [CLAUDE.md](xzawedSecurity/CLAUDE.md) |

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
   - 빌드 성공 (`pnpm build`)
   - `pnpm audit` 취약점 0개

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
- `WORKSPACE_ROOT`가 파일시스템 루트(`/`, `C:\`)이면 시작 시 거부
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

## SonarCloud 트러블슈팅

SonarCloud는 **GitHub App Automatic Analysis** 방식으로 동작한다. CI 워크플로우에 Sonar 스텝이 없다.

### 자동화된 CPD 진단 도구 (PR 생성 시 자동 실행)

PR을 열면 CI에서 두 개의 진단 댓글이 자동으로 올라온다. 스크린샷 없이 정확한 원인을 파악할 수 있다.

| 댓글 | 정보 | 소요 시간 |
|---|---|---|
| **jscpd** (`<!-- jscpd-report -->`) | 중복 파일 경로 + 줄 번호 (로컬과 동일한 알고리즘) | ~30초 |
| **SonarCloud API** (`<!-- sonar-cpd-report -->`) | SonarCloud 품질 게이트 상태 + 파일별 중복 밀도 | ~3-5분 (분석 대기) |

로컬에서 미리 확인할 때:
```bash
# 리포 루트에서
npx jscpd@3.5.10 --config .jscpd.json
```

### CPD 실패 시 대응 순서

1. PR 댓글에서 jscpd 리포트 확인 → 중복 파일·줄 번호 특정
2. `git diff master...HEAD -- <파일>` 로 PR 신규 코드 확인 → 반복 패턴을 헬퍼 함수로 추출
3. **exclusions 설정은 신뢰하지 말 것** — 실제 중복 제거가 유일한 확실한 해결책 (아래 Gotcha 참고)
4. SonarCloud API 댓글에서 품질 게이트 통과 여부 최종 확인

### sonar-project.properties 설정 원칙

```properties
# sonar.cpd.exclusions: Automatic Analysis에서 완전 무효
# sonar.exclusions 와일드카드(**/*.test.ts 등): PR 신규 코드 분석에서도 동작하지 않음
# → 특정 경로 exclusion(소스 파일 한정)만 일부 동작. 테스트 파일 CPD는 코드 리팩토링으로 해결할 것
sonar.exclusions=**/*.test.ts,**/*.spec.ts,**/__tests__/**,**/dist/**,**/*.d.ts
sonar.cpd.exclusions=**/*.test.ts,**/*.spec.ts,**/__tests__/**  # 스캐너 모드 대비
```

### Gotcha: SonarCloud PR 신규 코드 CPD 동작

- **새 코드 기준**: PR diff에서 추가·변경된 줄만 "신규 코드"로 계산
- **exclusions 무효**: sonar.exclusions 와일드카드(`**/*.test.ts`)는 PR 신규 코드 CPD 분석에서 동작하지 않음 (PR #19에서 runner.test.ts가 `**/*.test.ts` 패턴 적용 대상임에도 그대로 탐지됨)
- **CPD 토큰 임계값**: sonar.cpd.minimumTokens=100 설정에도 SonarCloud 내부 임계값은 ~30-37 토큰 (jscpd 100 토큰 기준과 다름)
- **유일한 해결책**: 중복 블록을 `loadModules()`, `makeFakeHandler()`, `makeRunner()` 등 헬퍼로 추출하여 실제 중복 제거

### 핫스팟 해소 절차

S4721 등 보안 핫스팟은 코드 수정만으로 자동 해소되지 않는다.
대시보드에서 "Safe" 직접 표시 → 새 커밋 push → 재분석 트리거.

### Former-Hotspot → Vulnerability 처리

SonarCloud가 기존 "Reviewed" 핫스팟을 오픈 Vulnerability로 재분류하는 경우 ("former-hotspot" 태그):

- **S5443 — Publicly writable directory**: 테스트 파일의 `/tmp` 목(mock) 경로는 실제 파일시스템 접근이 없으므로 `// NOSONAR` 억제가 적절
  ```typescript
  vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } })) // NOSONAR
  vi.stubEnv('HOME', '/tmp/test-home') // NOSONAR
  ```
- 프로덕션 코드의 `/tmp` 사용은 `os.tmpdir()` + 고유 서브디렉토리로 교체 (`fs.mkdtemp()` 권장)
- `// NOSONAR` 는 해당 줄만 억제 — 블록 전체에 사용하지 말 것

## 인프라

- **Docker**: `docker-compose.yml` — Redis + 9개 서비스 전체 실행. 각 서비스 디렉토리에 `Dockerfile` 포함.
- **CI/CD**: `.github/workflows/ci.yml` — PR마다 9개 서비스 병렬 빌드·테스트·감사 자동 실행. `redis-integration` 잡(Redis 서비스 컨테이너), `playwright-e2e` 잡(Electron E2E, xvfb-run), `all-checks-pass` 게이트 포함. PR 전용으로 jscpd(중복 파일·줄 번호) + SonarCloud API 폴링(품질 게이트·파일별 밀도) 댓글 자동 게시.
- **Dependabot**: `.github/dependabot.yml` — 9개 서비스 + GitHub Actions 주간 의존성 업데이트.
