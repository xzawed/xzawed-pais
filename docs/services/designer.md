# xzawedDesigner

Manager로부터 UI 설계 요청을 수신하여 ComponentSpec 배열과 UISpec을 생성하고 반환하는 서비스.

**포트:** 3004

---

## Overview

xzawedDesigner는 `manager:to-designer:{sessionId}` 스트림에서 `design_request`를 수신한다. `intent`, `context`, `targetFramework`, `designSystem`을 Claude API에 전달하여 컴포넌트 계층 구조(`ComponentSpec[]`)를 생성한다. 결과는 `designer:to-manager:{sessionId}` 스트림으로 발행한다.

**입력:** Redis Stream `manager:to-designer:{sessionId}` (`design_request`, `abort`)
**출력:** Redis Stream `designer:to-manager:{sessionId}` (`design_complete`, `error`)

---

## API / Redis Streams 인터페이스

### Redis 수신

스트림: `manager:to-designer:{sessionId}`
Consumer Group: `designer-consumers`

```typescript
interface ManagerToDesignerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_request' | 'abort'
  payload: {
    intent: string
    context: Record<string, unknown>
    targetFramework?: string  // 예: 'react' | 'vue' | 'svelte' (기본값: 'react')
    designSystem?: string     // 예: 'tailwind' | 'shadcn' | 'material' (기본값: 'tailwind')
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

스트림: `designer:to-manager:{sessionId}`

```typescript
interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'error'
  payload: {
    components?: ComponentSpec[]
    uiSpec?: UISpec
    content: string
  }
}

interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>  // propName: TypeScript 타입 문자열
  children?: ComponentSpec[]     // 재귀 구조 (z.lazy()로 정의)
  cssClasses?: string[]
}

interface UISpec {
  type: 'mockup_viewer' | 'form' | 'progress_board'
  title?: string
  content?: string
}
```

---

## Architecture

```
src/
├── index.ts            # 진입점: Redis consumer + Fastify 서버 시작
├── config.ts           # 환경변수 검증 (Zod)
├── server.ts           # Fastify HTTP 서버 (/health, 포트 3004)
├── designer.ts         # Designer 클래스 — handle() 메서드로 메시지 처리 조율
├── types.ts            # ManagerToDesignerMessage, DesignerToManagerMessage, ComponentSpec, UISpec 타입 정의
├── streams/
│   ├── consumer.ts     # Consumer — BaseConsumer<ManagerToDesignerMessage> 확장
│   └── producer.ts     # Producer — designer:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts       # ClaudeRunner — generateDesign() → ComponentSpec[] 생성
```

### 데이터 흐름

1. `consumer.ts` → `design_request` 수신
2. `designer.ts` → `runner.generateDesign()` 호출 (`targetFramework`, `designSystem` 전달)
3. `producer.publish()` → `design_complete` 발행

`ComponentSpec`의 `children` 필드는 재귀 구조이므로 `types.ts`에서 `z.lazy()`로 정의한다. `claude/runner.ts`의 `parseResponse()`는 JSON 펜스를 제거한 뒤 `ComponentSpec[]`을 파싱한다.

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `ANTHROPIC_API_KEY` | 예 | — | Anthropic API 키 |
| `CLAUDE_MODEL` | 아니오 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 아니오 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 아니오 | `3004` | HTTP 서버 포트 |
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

pnpm test        # Vitest 전체 실행

pnpm test src/designer.test.ts  # 단일 파일

pnpm build       # TypeScript 컴파일 → dist/
```

---

## Related

- [xzawedManager](manager.md)
- [Redis Streams](../concepts/redis-streams.md)
- [환경변수 레퍼런스](../reference/environment-variables.md)
