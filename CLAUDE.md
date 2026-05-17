# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 플랫폼 개요

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획 → 개발 → 디자인 → 테스트 → 빌드 → 모니터링을 자동으로 수행한다.

**모든 서비스는 이 단일 저장소에서 관리된다.** 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

전체 API·가이드·설계 스펙은 [`docs/`](docs/README.md)를 참고한다.

## 서비스 전체 현황

| 서비스 | 포트 | 상태 | 역할 | 상세 |
|---|---|---|---|---|
| xzawedOrchestrator | 3000 | ✅ 92/92 | 사용자 지시 수신·정제 후 Manager에 전달; GitHub·MCP·Plugin 통합 Electron UI | [CLAUDE.md](xzawedOrchestrator/CLAUDE.md) |
| xzawedManager | 3001 | ✅ 56/56 | Claude tool-calling 루프, 하위 에이전트 디스패치; github-ops ToolHandler | [CLAUDE.md](xzawedManager/CLAUDE.md) |
| xzawedPlanner | 3002 | ✅ 33/33 | intent → 실행 가능한 Step[] 분해 | [CLAUDE.md](xzawedPlanner/CLAUDE.md) |
| xzawedDeveloper | 3003 | ✅ 31/31 | 코드 생성·수정, 파일 I/O | [CLAUDE.md](xzawedDeveloper/CLAUDE.md) |
| xzawedDesigner | 3004 | ✅ 26/26 | UI 컴포넌트 스펙 설계 | [CLAUDE.md](xzawedDesigner/CLAUDE.md) |
| xzawedTester | 3005 | ✅ 28/28 | 테스트 실행·분석 | [CLAUDE.md](xzawedTester/CLAUDE.md) |
| xzawedBuilder | 3006 | ✅ 32/32 | 프로젝트 빌드 감지·실행 | [CLAUDE.md](xzawedBuilder/CLAUDE.md) |
| xzawedWatcher | 3007 | ✅ 26/26 | 파일 변경 감시·이벤트 스트리밍 | [CLAUDE.md](xzawedWatcher/CLAUDE.md) |
| xzawedSecurity | 3008 | ✅ 45/45 | OWASP 보안 감사 | [CLAUDE.md](xzawedSecurity/CLAUDE.md) |

## 공통 기술 스택

TypeScript 5 (strict mode) 공통 적용. 모든 서비스가 사용:

- **Fastify 5** — HTTP 서버 (`/health` 엔드포인트)
- **ioredis** — Redis Streams 소비자/생산자
- **Zod** — 환경변수 검증 및 스키마
- **@anthropic-ai/sdk** — Claude API 호출
- **Vitest 2/3** — 테스트 (`pool: 'forks'`, 프로세스 격리)
- **pnpm** — 패키지 매니저 (npm/yarn 사용 금지)

xzawedOrchestrator 추가: **@modelcontextprotocol/sdk** (MCP 서버), **React 19 + Zustand + Electron** (데스크톱 UI), **Turborepo** (xzawedOrchestrator·xzawedManager 모노레포), **@octokit/rest** (xzawedManager GitHub API).

xzawedOrchestrator Electron 앱 추가: GitHub OAuth 통합, McpProcessManager (child_process.spawn), PluginManager (Claude Code / xzawed 확장 관리), Zustand integrations.store.

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

서비스별 추가 환경 변수, 메시지 인터페이스, 아키텍처 세부 사항은 각 서비스 디렉토리의 `CLAUDE.md`를 참고한다.

## 개발 워크플로우

**모든 작업은 Pull Request(PR)를 통해 진행한다.**

```
feature/fix 브랜치 생성 → 작업 → 테스트 통과 → 코드 검토 → PR 생성 → 머지
```

### 규칙

1. `master`에 직접 push 금지 — 반드시 브랜치를 만들어 작업한다
2. PR은 작업 완료 후 마지막에 생성한다 (Draft PR 방식 사용 금지)
3. PR 생성 전 필수 조건:
   - 해당 서비스의 테스트 전체 통과 (`pnpm test`)
   - 빌드 성공 (`pnpm build`)
   - `pnpm audit` 취약점 0개

### 브랜치 네이밍

```
feat/<서비스>/<설명>   # 새 기능
fix/<서비스>/<설명>    # 버그 수정
docs/<설명>            # 문서만 변경
chore/<설명>           # 의존성, 설정 변경
```

예: `feat/developer/file-diff-support`, `fix/security/static-analyzer-false-positive`

## 인프라

- **Docker**: `docker-compose.yml` — Redis + 9개 서비스 전체 실행. 각 서비스 디렉토리에 `Dockerfile` 포함.
- **CI/CD**: `.github/workflows/ci.yml` — PR마다 9개 서비스 병렬 빌드·테스트·감사 자동 실행.
- **Dependabot**: `.github/dependabot.yml` — 9개 서비스 + GitHub Actions 주간 의존성 업데이트.
