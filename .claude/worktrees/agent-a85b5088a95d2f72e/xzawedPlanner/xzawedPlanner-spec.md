# CLAUDE.md — xzawedPlanner

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedPlanner는 xzawed 멀티 에이전트 시스템의 **계획 에이전트**다.
xzawedManager로부터 작업 지시를 받아 실행 가능한 단계별 계획으로 분해하고 반환한다.

## 역할 및 책임

- 사용자 의도(intent)와 컨텍스트(context)를 분석
- 작업을 구체적이고 실행 가능한 단계(Step[])로 분해
- 각 단계의 예상 소요 시간 및 의존 관계 정의
- 불명확한 요구사항 발견 시 info_request로 질의

## Redis Streams 인터페이스

**수신:** `manager:to-planner:{sessionId}`
**발신:** `planner:to-manager:{sessionId}`
**Consumer Group:** `planner-consumers`

### 수신 메시지 (ManagerToPlannerMessage)

```typescript
interface ManagerToPlannerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'plan_request' | 'abort'
  payload: {
    intent: string                    // 정제된 사용자 의도
    context: Record<string, unknown>  // 수집된 요구사항
    priority: 'normal' | 'high'
  }
}
```

### 발신 메시지 (PlannerToManagerMessage)

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
    uiSpec?: UISpec                   // 추가 입력 필요 시
  }
}

interface Step {
  id: string
  title: string
  description: string
  agentType: 'developer' | 'designer' | 'tester' | 'builder' | 'watcher' | 'security'
  dependencies: string[]             // 선행 step id[]
  estimatedMinutes: number
}
```

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health` 엔드포인트) |
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
PORT=3002
MODE=local
```

## 레포 초기 구조

```
xzawedPlanner/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts          # Redis consumer 시작
    ├── config.ts
    ├── server.ts         # /health
    ├── streams/
    │   ├── consumer.ts   # manager:to-planner:{sessionId} 구독
    │   └── producer.ts   # planner:to-manager:{sessionId} 발행
    ├── claude/
    │   └── runner.ts     # Claude APIRunner
    └── planner.ts        # 핵심 계획 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `plan_request` 수신
2. Claude에게 intent + context 전달하여 Step[] 생성
3. `plan_complete` 메시지로 발신
4. `/health` 엔드포인트 응답

## 핵심 명령어

```bash
pnpm install
pnpm dev       # 개발 모드 (tsx watch)
pnpm test      # Vitest
pnpm build     # tsc
```

## xzawedManager와의 연결

xzawedManager의 `plan_task` 도구가 이 서비스로 위임된다.
Manager의 `tools/plan-task.ts`를 `ClaudeStubHandler`에서 `RedisAgentHandler`로 교체하면 연결 완료.
