# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedDesigner는 xzawed 멀티 에이전트 시스템의 **UI 설계 에이전트**다.
xzawedManager로부터 UI/UX 설계 요청을 받아 ComponentSpec 구조로 컴포넌트 스펙을 생성하고 반환한다.

현재 상태: **구현 완료 (26/26 테스트 통과)**

## 핵심 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <file>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일
```

## 아키텍처

```
src/
├── index.ts          # 진입점: Redis consumer 시작
├── config.ts         # 환경변수 검증 (zod)
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3004)
├── designer.ts       # UI 컴포넌트 스펙 생성 조율 로직
├── types.ts          # ComponentSpec (z.lazy 재귀 스키마), 메시지 타입
├── streams/
│   ├── consumer.ts   # 구독: manager:to-designer:{sessionId}
│   └── producer.ts   # 발행: designer:to-manager:{sessionId}
└── claude/
    └── runner.ts     # Anthropic SDK — UI 컴포넌트 스펙 생성
```

### 데이터 흐름

1. Redis consumer → `design_request` 수신 (`ManagerToDesignerMessage`)
2. `designer.ts` → `claude/runner.ts` 호출, ComponentSpec[] 생성
3. Redis producer → `design_complete` 발행 (`DesignerToManagerMessage`)

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
  }
}

// 발신: designer:to-manager:{sessionId}
interface DesignerToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'design_complete' | 'error'
  payload: {
    components?: ComponentSpec[]
    content: string
  }
}

interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>
  children?: ComponentSpec[]   // z.lazy()로 재귀 정의
  cssClasses?: string[]
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3004
MODE=local
```

## 구현 참고사항

- `ComponentSpec`의 재귀 구조는 `z.lazy()`로 정의; `z.ZodType<any>` 어노테이션 필요 (`exactOptionalPropertyTypes` 호환)
- `claude/runner.ts`의 `parseResponse`는 JSON 펜스 제거 후 `ComponentSpec[]` 파싱
- Manager 연결: `xzawedManager/packages/server/src/tools/design-ui.ts` (`createDesignUiHandler`)

## 보안 구현 패턴

- **Redis 메시지 검증**: 수신 메시지는 `XxxMessageSchema.safeParse()`로 검증. 실패 시 xack 후 skip
- **Redis xack 보장**: `handler()` 호출을 `try/finally`로 감싸 예외 발생 시에도 xack 실행 (PEL 누수 방지)

## xzawed 생태계 연결

전체 suite: 현재 저장소 루트
- 에이전트 간 통신: Redis Streams (ioredis), 포트 3002–3008
- 설계 스펙: `docs/services/designer.md`
