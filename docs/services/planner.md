# xzawedPlanner — 계획 에이전트

**역할:** xzawedManager로부터 작업 지시를 받아 실행 가능한 단계별 계획(Step[])으로 분해하고 반환한다.

**포트:** 3002 | **상태:** 구현 완료

---

## 소스 구조

```
src/
├── index.ts             # Redis consumer 시작점
├── server.ts            # Fastify /health 엔드포인트
├── config.ts            # 환경변수 및 설정 관리
├── planner.ts           # intent + context → Step[] 분해 핵심 로직
├── streams/
│   ├── consumer.ts      # manager:to-planner:{sessionId} 구독
│   └── producer.ts      # planner:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts        # Anthropic SDK를 통한 Claude 호출
```

## Redis Streams 인터페이스

**Consumer Group:** `planner-consumers`

### 수신 (ManagerToPlannerMessage)

```typescript
interface ManagerToPlannerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'plan_request' | 'abort'
  payload: {
    intent: string
    context: Record<string, unknown>
    priority: 'normal' | 'high'
  }
}
```

### 발신 (PlannerToManagerMessage)

```typescript
interface PlannerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
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
  dependencies: string[]   // 선행 step id[]
  estimatedMinutes: number
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3002
MODE=local
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm test -- --reporter=verbose <파일명>
pnpm build
```

## xzawedManager 연결

`tools/plan-task.ts`의 `ClaudeStubHandler`를 `RedisAgentHandler`로 교체하면 연결 완료.
