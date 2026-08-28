# CLAUDE.md — xzawedPlanner

## 프로젝트 개요

xzawedPlanner는 xzawed 멀티 에이전트 시스템의 **계획 에이전트**다.
xzawedManager로부터 작업 지시(intent)를 받아 실행 가능한 단계별 계획(`Step[]`)으로 분해하고 반환한다.

## 구조

`src/` 트리 → [docs/services/planner.md](../docs/services/planner.md#architecture). **여기 복사하지 않는다** —
두 벌을 손으로 유지하다 양쪽이 다 낡았다(한쪽은 없는 파일을, 다른 쪽은 없는 테스트를 적고 있었다).
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
  type: 'plan_complete' | 'info_request' | 'error' | 'agent_query'
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

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

## 구현 참고사항

- `claude/runner.ts`: Claude JSON 응답을 `PlanResponseSchema.safeParse()`(Zod)로 검증. 검증 실패 시 단일 step fallback 반환
- `StepSchema`: `agentType` enum 강제, `estimatedMinutes` 0초과 480분 이하 제약
- `JSON.parse() as Type` 캐스트 금지 — 반드시 `safeParse` 사용
- **Redis 메시지 검증**: `ManagerToPlannerMessageSchema.safeParse()`. **실패는 `invalid_schema` 로 DLQ 격리**한다(shared `BaseConsumer` — 조용히 ack 하고 버리지 않는다). `try/finally` 는 `handler()` 가 아니라 **배치**에 걸려 있다
- **Redis xack 보장**: `handler()` `try/finally` 래핑으로 PEL 누수 방지

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 답변 모드(`answerQuery`)와 교차질의 발생을 통합 — `generatePlan`이 `AgentQuery` 반환 시 `agent_query` 타입으로 발행(교차질의 개시), 수신 query는 `runner.answerQuery`로 답변
- `plan_complete`에 도메인 지식 emit: `knowledge`는 `{content, category}` 항목 배열이며 `category`는 `decision`/`constraint`/`rule`/`tech` 중 하나(모호 시 생략, 키 자체 생략으로 정규화)

**Manager 연결:** `xzawedManager/packages/server/src/tools/plan-task.ts` (`createPlanTaskHandler`)
