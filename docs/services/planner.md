# xzawedPlanner

Manager로부터 작업 의도를 수신하여 실행 가능한 Step[] 계획으로 분해하고 반환하는 서비스.

**포트:** 3002

---

## Overview

xzawedPlanner는 `manager:to-planner:{sessionId}` 스트림에서 `plan_request`를 수신한다. `intent`와 `context`를 Claude API에 전달하여 에이전트별로 분배 가능한 Step 배열을 생성한다. 결과는 `planner:to-manager:{sessionId}` 스트림으로 발행한다. 추가 정보가 필요하면 `info_request`와 함께 UISpec 폼을 반환한다.

**입력:** Redis Stream `manager:to-planner:{sessionId}` (`plan_request`, `abort`)
**출력:** Redis Stream `planner:to-manager:{sessionId}` (`plan_complete`, `info_request`, `error`)

---

## API / Redis Streams 인터페이스

### Redis 수신

스트림: `manager:to-planner:{sessionId}`
Consumer Group: `planner-consumers`

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
    userContext?: UserContext
  }
}

interface UserContext {
  userId: string
  projectId: string
  workspaceRoot: string
  githubRepo?: { owner: string; repo: string; branch: string }
}
```

### Redis 발신

스트림: `planner:to-manager:{sessionId}`

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
  dependencies: string[]   // 선행 Step id 배열
  estimatedMinutes: number // 0 초과, 480 이하
}

interface UISpec {
  type: 'form'
  fields: Array<{
    id: string
    label: string
    type: 'text' | 'select' | 'multiline'
    options?: string[]
    required?: boolean
  }>
}
```

---

## Architecture

```
src/
├── index.ts             # 진입점: Redis consumer + Fastify 서버 시작
├── config.ts            # 환경변수 검증 (Zod)
├── server.ts            # Fastify HTTP 서버 (/health, 포트 3002)
├── planner.ts           # Planner 클래스 — handle() 메서드로 메시지 처리 조율
├── types.ts             # ManagerToPlannerMessage, PlannerToManagerMessage, Step, UISpec 타입 정의
├── streams/
│   ├── consumer.ts      # Consumer — BaseConsumer<ManagerToPlannerMessage> 확장
│   └── producer.ts      # Producer — planner:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts        # ClaudeRunner — generatePlan() → Step[] 생성, Zod safeParse 검증
```

`claude/runner.ts`는 Claude 응답을 `PlanResponseSchema.safeParse()`로 검증한다. 검증 실패 시 단일 Step fallback을 반환한다. `ClarificationNeeded` 예외를 던지면 `planner.ts`가 `info_request`로 변환한다.

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `ANTHROPIC_API_KEY` | 예 | — | Anthropic API 키 |
| `CLAUDE_MODEL` | 아니오 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 아니오 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 아니오 | `3002` | HTTP 서버 포트 |
| `MODE` | 아니오 | `local` | `local` \| `remote` |

---

## Development

> 사전 조건: xzawedShared를 먼저 빌드해야 한다.
> ```bash
> cd xzawedShared && pnpm install && pnpm build && cd ..
> ```

```bash
pnpm install

pnpm dev         # tsx watch 개발 모드

pnpm test        # Vitest 전체 실행 (33건)

pnpm test -- --reporter=verbose src/planner.test.ts  # 단일 파일

pnpm build       # TypeScript 컴파일 → dist/
```

---

## Related

- [xzawedManager](manager.md)
- [Redis Streams](../concepts/redis-streams.md)
- [환경변수 레퍼런스](../reference/environment-variables.md)
