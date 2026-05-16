# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedPlanner는 xzawed 멀티 에이전트 시스템의 **계획 에이전트**다. xzawedManager로부터 작업 지시를 받아 실행 가능한 단계별 계획으로 분해하고 반환한다.

현재 상태: **구현 완료**

## 핵심 명령어

```bash
pnpm install
pnpm dev       # 개발 모드 (tsx watch)
pnpm test      # Vitest 전체 실행
pnpm test -- --reporter=verbose <파일명>  # 단일 테스트 파일 실행
pnpm build     # tsc 컴파일
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

## 아키텍처

이 서비스는 Redis Streams 기반 멀티 에이전트 파이프라인에서 동작한다:

```
xzawedManager → Redis Stream → xzawedPlanner → Claude API
                manager:to-planner:{sessionId}

xzawedPlanner → Redis Stream → xzawedManager
                planner:to-manager:{sessionId}
```

**레이어 구조:**
- `src/index.ts` — Redis consumer 시작점
- `src/server.ts` — Fastify `/health` 엔드포인트
- `src/config.ts` — 환경변수 및 설정 관리
- `src/streams/consumer.ts` — `manager:to-planner:{sessionId}` 구독, Consumer Group: `planner-consumers`
- `src/streams/producer.ts` — `planner:to-manager:{sessionId}` 발행
- `src/claude/runner.ts` — Anthropic SDK를 통한 Claude 호출
- `src/planner.ts` — intent + context → Step[] 분해 핵심 로직

## Redis Streams 메시지 인터페이스

### 수신 (ManagerToPlannerMessage)

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
  }
}
```

### 발신 (PlannerToManagerMessage)

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
  dependencies: string[]   // 선행 step id[]
  estimatedMinutes: number
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3002
MODE=local
```

## xzawedManager와의 연결

xzawedManager의 `tools/plan-task.ts` → `createPlanTaskHandler(redisUrl)`으로 연결 완료.
