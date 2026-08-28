# CLAUDE.md — xzawedDesigner

## 프로젝트 개요

xzawedDesigner는 xzawed 멀티 에이전트 시스템의 **UI 설계 에이전트**다.
xzawedManager로부터 UI/UX 설계 요청을 받아 ComponentSpec 구조로 컴포넌트 스펙을 생성하고 반환한다.

## 구조

`src/` 트리 → [docs/services/designer.md](../docs/services/designer.md#architecture). **여기 복사하지 않는다** —
두 벌을 손으로 유지하다 양쪽이 다 낡았다(한쪽은 없는 파일을, 다른 쪽은 없는 테스트를 적고 있었다).
## Redis Streams 인터페이스

**Consumer Group:** `designer-consumers`

```typescript
// 수신: manager:to-designer:{sessionId}
interface ManagerToDesignerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'design_request' | 'abort'
  payload: {
    intent: string
    context: Record<string, unknown>
    targetFramework?: string      // 예: 'react', 'vue'
    designSystem?: string         // 예: 'shadcn', 'material'
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: designer:to-manager:{sessionId}
interface DesignerToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'design_complete' | 'error' | 'agent_query'
  payload: {
    components?: ComponentSpec[]
    uiSpec?: UISpec
    designed?: DesignAudit   // 설계 수행 집계 — Manager 가 자기검증에 쓴다
    content: string
  }
}

interface DesignAudit {
  source: 'llm' | 'fallback'   // fallback = 파싱 실패로 발행한 generic 스텁
  components: number           // 같은 메시지에 실은 컴포넌트 수
}

interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>
  children?: ComponentSpec[]    // z.lazy()로 재귀 정의
  cssClasses?: string[]
}

interface UISpec {
  type: 'mockup_viewer' | 'form' | 'progress_board'
  title?: string
  content?: string
}
```

## 환경 변수

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

## 구현 참고사항

- `ComponentSpec` 재귀 구조: `z.lazy()`로 정의; `z.ZodType<ComponentSpec>` 어노테이션 필요 (`exactOptionalPropertyTypes` 호환)
- `claude/runner.ts`의 `parseResponse`: JSON 펜스 제거 후 `ComponentSpec[]` 파싱
- **파싱 실패 폴백은 컴포넌트 1개를 낸다 — 그래서 개수로는 실패를 구분할 수 없다.** 폴백은 generic 스텁을 `design_complete`로 발행하므로 전선 위 모양이 성공과 같고, `console.warn`은 이 프로세스 로그에만 남는다. 소비자(Manager 자기검증)가 구분할 수 있는 유일한 신호가 `designed.source`다 — **폴백 경로를 늘릴 때 이 필드를 반드시 함께 채운다**
- **Redis 메시지 검증**: `ManagerToDesignerMessageSchema.safeParse()`. **실패는 `invalid_schema` 로 DLQ 격리**한다(shared `BaseConsumer`). `try/finally` 는 **배치**에 걸린다
- **Redis xack 보장**: `handler()` 호출을 `try/finally`로 감싸 PEL 누수 방지

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 교차질의 발생·답변을 통합 — `generateDesign`이 `AgentQuery` 반환 시 `agent_query`로 발행(Designer↔Developer 교차질의 개시), 수신 query는 `runner.answerQuery`로 답변
- `design_complete`에 도메인 지식 emit: `knowledge` 필드로 디자인 도메인 결정·제약 반환

**Manager 연결:** `xzawedManager/packages/server/src/tools/design-ui.ts` (`createDesignUiHandler`)
