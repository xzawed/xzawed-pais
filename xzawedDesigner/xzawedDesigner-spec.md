# CLAUDE.md — xzawedDesigner

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedDesigner는 xzawed 멀티 에이전트 시스템의 **UI/UX 설계 에이전트**다.
xzawedManager로부터 디자인 요구사항을 받아 컴포넌트 스펙·레이아웃·스타일 가이드를 생성하고 반환한다.

## 역할 및 책임

- UI 요구사항 분석 및 컴포넌트 계층 설계
- 레이아웃, 색상, 타이포그래피 스펙 정의
- React / Vue / HTML 타깃별 컴포넌트 스펙 생성
- `UISpec` JSON 생성 (Orchestrator의 동적 패널에서 렌더링 가능한 포맷)
- Figma 연동 가이드 (선택적)

## Redis Streams 인터페이스

**수신:** `manager:to-designer:{sessionId}`
**발신:** `designer:to-manager:{sessionId}`
**Consumer Group:** `designer-consumers`

### 수신 메시지 (ManagerToDesignerMessage)

```typescript
interface ManagerToDesignerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_request' | 'abort'
  payload: {
    requirements: string              // 디자인 요구사항
    stack: 'react' | 'vue' | 'html'  // 타깃 프레임워크
    context: Record<string, unknown>
  }
}
```

### 발신 메시지 (DesignerToManagerMessage)

```typescript
interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'info_request' | 'error'
  payload: {
    spec?: UIDesignSpec
    components?: ComponentSpec[]
    content: string
    uiSpec?: UISpec                   // 추가 입력 필요 시
  }
}

interface UIDesignSpec {
  layout: 'single-column' | 'sidebar' | 'dashboard' | 'custom'
  colorScheme: Record<string, string>
  typography: Record<string, string>
  breakpoints: Record<string, number>
}

interface ComponentSpec {
  name: string
  props: PropDef[]
  description: string
  codeHint: string                    // 구현 힌트
}
```

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health`) |
| Claude SDK | `@anthropic-ai/sdk` |
| Redis | `ioredis` |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm |

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3004
MODE=local
```

## 레포 초기 구조

```
xzawedDesigner/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts
    ├── config.ts
    ├── server.ts
    ├── streams/
    │   ├── consumer.ts   # manager:to-designer:{sessionId}
    │   └── producer.ts   # designer:to-manager:{sessionId}
    ├── claude/
    │   └── runner.ts
    └── designer.ts       # 디자인 스펙 생성 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `design_request` 수신
2. Claude에게 requirements + stack 전달하여 UIDesignSpec + ComponentSpec[] 생성
3. `design_complete` 메시지로 발신

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager와의 연결

xzawedManager의 `design_ui` 도구가 이 서비스로 위임된다.
Manager의 `tools/design-ui.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.
