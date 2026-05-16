# xzawedManager — 총관리자

**역할:** xzawedOrchestrator로부터 작업 지시를 수신하고 Claude tool-calling 루프를 통해 7개 전문 에이전트에 위임한다.

**포트:** 3001 | **상태:** 구현 완료 (51/51 테스트)

---

## 패키지 구조

```
xzawedManager/
└── packages/
    └── server/
        └── src/
            ├── index.ts            # 진입점: Redis consumer 시작
            ├── config.ts           # 환경 변수 검증
            ├── server.ts           # Fastify HTTP (/health, port 3001)
            ├── streams/            # Redis consumer + producer
            ├── claude/runner.ts    # Claude tool-calling 루프
            ├── tools/              # ToolHandler 7개
            ├── sessions/           # 세션 상태 추적
            └── api/                # health 라우트
```

## Redis Streams 인터페이스

**수신:** `orchestrator:to-manager:{sessionId}` (consumer group: `manager-consumers`)

| type | 처리 |
|------|------|
| `task_request` | Claude tool-calling 루프 시작 |
| `info_response` | 대기 중 루프 재개 |
| `abort` | 루프 즉시 중단 |

**발신:** `manager:to-orchestrator:{sessionId}`

| type | 시점 |
|------|------|
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

초기 구현: `ClaudeStubHandler` → 하위 에이전트 완성 시 `RedisAgentHandler`로 교체. Manager 코드 변경 없음.

## 7개 ToolHandler

| 도구 | 위임 대상 | Redis 스트림 |
|------|-----------|-------------|
| `plan_task` | xzawedPlanner | `manager:to-planner:{sessionId}` |
| `develop_code` | xzawedDeveloper | `manager:to-developer:{sessionId}` |
| `design_ui` | xzawedDesigner | `manager:to-designer:{sessionId}` |
| `run_tests` | xzawedTester | `manager:to-tester:{sessionId}` |
| `build_project` | xzawedBuilder | `manager:to-builder:{sessionId}` |
| `watch_changes` | xzawedWatcher | `manager:to-watcher:{sessionId}` |
| `security_audit` | xzawedSecurity | `manager:to-security:{sessionId}` |

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3001
MODE=local
```

## 핵심 명령어

```bash
pnpm install
cd packages/server && pnpm dev
pnpm test
cd packages/server && pnpm test src/tools/plan-task.test.ts
pnpm build
```

## 관련 문서

- [설계 스펙](../specs/2026-05-15-manager-design.md)
- [구현 계획](../plans/2026-05-15-manager-server.md)
