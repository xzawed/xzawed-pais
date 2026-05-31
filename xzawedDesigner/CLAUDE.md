# CLAUDE.md — xzawedDesigner

## 프로젝트 개요

xzawedDesigner는 xzawed 멀티 에이전트 시스템의 **UI 설계 에이전트**다.
xzawedManager로부터 UI/UX 설계 요청을 받아 ComponentSpec 구조로 컴포넌트 스펙을 생성하고 반환한다.

**현재 상태: 구현 완료 (26/26 테스트 통과)**

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
├── config.ts         # 환경변수 검증 (Zod) — PORT=3004, WORKSPACE_ROOT 필수
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3004)
├── designer.ts       # UI 컴포넌트 스펙 생성 조율 로직
├── types.ts          # ComponentSpec (z.lazy 재귀 스키마), ManagerToDesignerMessageSchema
├── streams/
│   ├── consumer.ts   # BaseConsumer 확장 — manager:to-designer:{sessionId}
│   ├── producer.ts   # designer:to-manager:{sessionId} 발행
│   └── runner.test.ts
└── claude/
    ├── runner.ts     # Anthropic SDK — intent → ComponentSpec[] 생성
    └── runner.test.ts
```

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

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3004` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | validateWorkspaceRoot() 검증 용. Docker: `/workspace` |

## 구현 참고사항

- `ComponentSpec` 재귀 구조: `z.lazy()`로 정의; `z.ZodType<ComponentSpec>` 어노테이션 필요 (`exactOptionalPropertyTypes` 호환)
- `claude/runner.ts`의 `parseResponse`: JSON 펜스 제거 후 `ComponentSpec[]` 파싱
- **Redis 메시지 검증**: 수신 메시지는 `ManagerToDesignerMessageSchema.safeParse()`로 검증. 실패 시 xack 후 skip
- **Redis xack 보장**: `handler()` 호출을 `try/finally`로 감싸 PEL 누수 방지

**Manager 연결:** `xzawedManager/packages/server/src/tools/design-ui.ts` (`createDesignUiHandler`)
