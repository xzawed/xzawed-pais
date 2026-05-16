# xzawedDesigner — 디자인 에이전트

**역할:** xzawedManager로부터 UI 디자인 요청을 받아 컴포넌트 명세와 UISpec을 생성·반환한다.

**포트:** 3004 | **상태:** 구현 완료 (26/26 테스트)

---

## 소스 구조

```
src/
├── index.ts
├── config.ts
├── server.ts            # Fastify /health
├── designer.ts          # 디자인 조율 로직
├── streams/
│   ├── consumer.ts      # manager:to-designer:{sessionId}
│   └── producer.ts      # designer:to-manager:{sessionId}
└── claude/
    └── runner.ts        # Anthropic SDK 호출
```

## Redis Streams 인터페이스

**Consumer Group:** `designer-consumers`

### 수신 (ManagerToDesignerMessage)

```typescript
interface ManagerToDesignerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_request' | 'abort'
  payload: {
    intent: string
    context: Record<string, unknown>
    targetFramework?: string   // 'react' | 'vue' | 'svelte' | ...
    designSystem?: string      // 'tailwind' | 'shadcn' | 'material' | ...
  }
}
```

### 발신 (DesignerToManagerMessage)

```typescript
interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'design_progress' | 'error'
  payload: {
    components?: ComponentSpec[]
    uiSpec?: UISpec
    content: string
  }
}

interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>    // propName: TypeScript 타입
  children?: ComponentSpec[]
  cssClasses?: string[]
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3004
MODE=local
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager 연결

`tools/design-ui.ts`의 `ClaudeStubHandler`를 `RedisAgentHandler`로 교체하면 연결 완료.
