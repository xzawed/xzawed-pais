# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedManager(총관리자)는 xzawed 멀티 에이전트 시스템의 **두 번째 계층**이다.  
xzawedOrchestrator로부터 Redis Streams로 작업 지시를 수신하고, Claude tool-calling 루프를 통해 처리한 뒤 결과를 반환한다.

현재 상태: **구현 완료 (56/56 테스트 통과)** — 8개 ToolHandler 모두 `RedisAgentHandler` 또는 직접 Octokit 기반으로 구현.

설계 스펙: `docs/specs/2026-05-15-manager-design.md`

## 핵심 명령어

```bash
# 의존성 설치
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트
pnpm test

# 특정 패키지 테스트
cd packages/server && pnpm test

# 특정 테스트 파일 실행
cd packages/server && pnpm test src/tools/plan-task.test.ts

# 빌드
pnpm build
```

## 아키텍처

```
packages/
└── server/
    └── src/
        ├── index.ts            # 진입점: Redis consumer 시작
        ├── config.ts           # 환경 변수 검증
        ├── server.ts           # Fastify HTTP (/health, port 3001)
        ├── streams/            # Redis consumer + producer
        ├── claude/runner.ts    # Claude tool-calling 루프
        ├── tools/              # ToolHandler 8개 (plan-task, develop-code, design-ui, run-tests, build-project, watch-changes, security-audit, github-ops)
        ├── sessions/           # 세션 상태 추적
        └── api/                # health 라우트
```

## Redis Streams 인터페이스

**수신:** `orchestrator:to-manager:{sessionId}` (consumer group: `manager-consumers`)
| type | 처리 |
|---|---|
| `task_request` | Claude tool-calling 루프 시작 |
| `info_response` | 대기 중 루프 재개 |
| `abort` | 루프 즉시 중단 |

**발신:** `manager:to-orchestrator:{sessionId}`
| type | 시점 |
|---|---|
| `status_update` | 도구 호출 시작/완료마다 |
| `info_request` | 사용자 추가 입력 필요 시 (uiSpec 포함 가능) |
| `task_complete` | 모든 처리 완료 |
| `error` | 처리 실패 |

## ToolHandler 패턴

```typescript
interface ToolHandler<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  execute(input: TInput, sessionId: string): Promise<TOutput>
}
```

8개 핸들러:
- 7개: `RedisAgentHandler` 팩토리 함수 — `createPlanTaskHandler`, `createDevelopCodeHandler`, `createDesignUiHandler`, `createRunTestsHandler`, `createBuildProjectHandler`, `createWatchChangesHandler`, `createSecurityAuditHandler`
- 1개: **`createGithubOpsHandler`** — Octokit 직접 호출 (createRepo, createBranch, commitAndPush, createPR, createIssue, mergeBranch, listRepos, listBranches). `GITHUB_TOKEN` 환경변수 설정 시에만 등록됨.

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3001
MODE=local
GITHUB_TOKEN=   # 선택: Orchestrator가 세션별로 전달. 설정 시 github_ops 핸들러 활성화
```

## 시스템 위치

```
사용자 → Electron 앱 → xzawedOrchestrator (3000) → [Redis] → xzawedManager (3001)
                                                                    ↓ ToolHandler
                                          Planner / Developer / Designer / Tester / Builder / Watcher / Security
```

관련 프로젝트: `f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\` — 전체 9개 서비스 모두 구현 완료
