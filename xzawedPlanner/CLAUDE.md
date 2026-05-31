# CLAUDE.md — xzawedPlanner

## 프로젝트 개요

xzawedPlanner는 xzawed 멀티 에이전트 시스템의 **계획 에이전트**다.
xzawedManager로부터 작업 지시(intent)를 받아 실행 가능한 단계별 계획(`Step[]`)으로 분해하고 반환한다.

**현재 상태: 구현 완료 (33/33 테스트 통과)**

## 핵심 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <파일>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일 → dist/
```

## 디렉토리 구조

```
src/
├── index.ts          # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner 초기화
├── config.ts         # 환경변수 검증 (Zod) — PORT=3002, WORKSPACE_ROOT 필수
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3002)
├── planner.ts        # intent + context → Step[] 분해 핵심 로직
├── types.ts          # Step, UISpec, ManagerToPlannerMessageSchema, PlannerToManagerMessage
├── streams/
│   ├── consumer.ts   # BaseConsumer 확장 — manager:to-planner:{sessionId}
│   ├── consumer.test.ts
│   ├── producer.ts   # planner:to-manager:{sessionId} 발행
│   ├── producer.test.ts
│   └── runner.test.ts  (claude/)
└── claude/
    ├── runner.ts     # Anthropic SDK — intent → PlanResponse JSON 생성
    └── runner.test.ts
```

## Redis Streams 인터페이스

**Consumer Group:** `planner-consumers`

```typescript
// 수신: manager:to-planner:{sessionId}
interface ManagerToPlannerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'plan_request' | 'abort'
  payload: {
    intent: string
    context: Record<string, unknown>
    priority: 'normal' | 'high'
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: planner:to-manager:{sessionId}
interface PlannerToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'plan_complete' | 'info_request' | 'error'
  payload: {
    steps?: Step[]
    estimatedTime?: string
    content: string
    uiSpec?: UISpec
  }
}

interface Step {
  id: string
  title: string
  description: string
  agentType: 'developer' | 'designer' | 'tester' | 'builder' | 'watcher' | 'security'
  dependencies: string[]    // 선행 step id[]
  estimatedMinutes: number  // 0초과 480분 이하
}
```

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3002` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | validateWorkspaceRoot() 검증 용. Docker: `/workspace` |

## 구현 참고사항

- `claude/runner.ts`: Claude JSON 응답을 `PlanResponseSchema.safeParse()`(Zod)로 검증. 검증 실패 시 단일 step fallback 반환
- `StepSchema`: `agentType` enum 강제, `estimatedMinutes` 0초과 480분 이하 제약
- `JSON.parse() as Type` 캐스트 금지 — 반드시 `safeParse` 사용
- **Redis 메시지 검증**: `ManagerToPlannerMessageSchema.safeParse()`. 실패 시 xack 후 skip
- **Redis xack 보장**: `handler()` `try/finally` 래핑으로 PEL 누수 방지

**Manager 연결:** `xzawedManager/packages/server/src/tools/plan-task.ts` (`createPlanTaskHandler`)
