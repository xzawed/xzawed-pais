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

- **폴백 계획은 성공과 구별되지 않는다.** 파싱 실패 시 `fallback()` 이 `agentType: 'developer'` 단일 Step 을 만들어 그대로 `plan_complete` 로 발행한다 — Manager 는 그것이 진짜 1단계 계획인지 알 수 없다. Designer 는 같은 문제를 `designed.source` 로 표시하는데 **여기엔 그 필드가 없다**
- `claude/runner.ts`: Claude JSON 응답을 `PlanResponseSchema.safeParse()`(Zod)로 검증. 검증 실패 시 단일 step fallback 반환
- `StepSchema`: `agentType` enum 강제, `estimatedMinutes` 0초과 480분 이하 제약
- `JSON.parse() as Type` 캐스트 금지 — 반드시 `safeParse` 사용
- **소비 계약(스키마 검증·DLQ·ack·재시도)은 shared `BaseConsumer` 가 정본**이다 → [xzawedShared/CLAUDE.md](../xzawedShared/CLAUDE.md). 여기서 다시 쓰지 않는다 — 서비스마다 복제하다 세 곳이 같은 오기를 갖고 있었다

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 답변 모드(`answerQuery`)와 교차질의 발생을 통합 — `generatePlan`이 `AgentQuery` 반환 시 `agent_query` 타입으로 발행(교차질의 개시), 수신 query는 `runner.answerQuery`로 답변
- `plan_complete`에 도메인 지식 emit: `knowledge`는 `{content, category}` 항목 배열이며 `category`는 `decision`/`constraint`/`rule`/`tech` 중 하나(모호 시 생략, 키 자체 생략으로 정규화)

**Manager 연결:** `xzawedManager/packages/server/src/tools/plan-task.ts` (`createPlanTaskHandler`)
