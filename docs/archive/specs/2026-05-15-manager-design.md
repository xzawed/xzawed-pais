# xzawedManager 설계 스펙

**날짜:** 2026-05-15
**상태:** 승인됨
**범위:** xzawedManager 독립 서비스 구현

---

## 1. 개요

xzawedManager(이하 총관리자)는 xzawed 멀티 에이전트 시스템의 두 번째 계층이다. xzawedOrchestrator로부터 정제된 작업 지시를 Redis Streams로 수신하고, Claude tool-calling 루프를 통해 작업을 처리한 뒤 결과를 Orchestrator에 반환한다.

초기 버전에서는 하위 에이전트(xzawedPlanner 등)가 아직 구현되지 않으므로, 각 도구는 Claude API가 직접 처리하는 stub으로 구현한다. 이후 실제 에이전트가 완성되면 `ToolHandler` 인터페이스 계약에 따라 Manager 코드 변경 없이 교체된다.

### 위치

```
f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedManager\
```

독립 Git 레포. xzawedOrchestrator와 별도 프로젝트.

---

## 2. 시스템 위치

```
사용자
  ↕ Electron 앱
xzawedOrchestrator   ← 완성
  ↕ Redis Streams
xzawedManager        ← 이번 구현
  ↕ ToolHandler 인터페이스
├── xzawedPlanner    ← 추후 별도 구현
├── xzawedDeveloper  ← 추후 별도 구현
├── xzawedDesigner   ← 추후 별도 구현
├── xzawedTester     ← 추후 별도 구현
├── xzawedBuilder    ← 추후 별도 구현
├── xzawedWatcher    ← 추후 별도 구현
└── xzawedSecurity   ← 추후 별도 구현
```

---

## 3. 아키텍처

### 3.1 패키지 구조

```
xzawedManager/
├── package.json
├── tsconfig.base.json
├── pnpm-workspace.yaml
├── turbo.json
├── .env.example
├── .gitignore
└── packages/
    └── server/
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        └── src/
            ├── index.ts              # 진입점: Redis consumer 시작
            ├── config.ts             # 환경 변수 검증
            ├── server.ts             # Fastify 서버 (/health)
            ├── streams/
            │   ├── consumer.ts       # orchestrator:to-manager:{sessionId} 구독
            │   └── producer.ts       # manager:to-orchestrator:{sessionId} 발행
            ├── claude/
            │   └── runner.ts         # Claude APIRunner (tool-calling 지원)
            ├── tools/
            │   ├── handler.interface.ts  # ToolHandler<TInput, TOutput>
            │   ├── registry.ts           # 도구 등록 및 조회
            │   ├── plan-task.ts
            │   ├── develop-code.ts
            │   ├── design-ui.ts
            │   ├── run-tests.ts
            │   ├── build-project.ts
            │   ├── watch-changes.ts
            │   └── security-audit.ts
            ├── sessions/
            │   └── session.store.ts  # 세션 상태 추적
            └── api/
                └── health.route.ts
```

### 3.2 핵심 흐름

```
1. Redis Consumer: orchestrator:to-manager:{sessionId} 구독
2. task_request 수신 → Claude tool-calling 루프 시작
3. Claude가 도구 선택·호출
   a. 도구 호출 시작 → status_update 발행
   b. ToolHandler.execute() 실행 (현재: Claude stub)
   c. 도구 완료 → status_update 발행 (결과 포함)
4. Claude가 info_request 필요 시
   → info_request + uiSpec 발행 → Orchestrator에 전달
   → info_response 수신 시 루프 재개
5. 모든 도구 처리 완료 → task_complete 발행
6. 에러 발생 → error 발행 후 세션 정리
```

---

## 4. Redis Streams 인터페이스

### 4.1 수신 스트림

**키:** `orchestrator:to-manager:{sessionId}`
**Consumer Group:** `manager-consumers`

| type | 동작 |
|---|---|
| `task_request` | Claude tool-calling 루프 시작 |
| `info_response` | 사용자 답변 수신 → 대기 중 루프 재개 |
| `abort` | 진행 중인 루프 즉시 중단 |

### 4.2 발신 스트림

**키:** `manager:to-orchestrator:{sessionId}`

| type | 시점 | payload |
|---|---|---|
| `status_update` | 도구 호출 시작/완료마다 | `{ agentId, content }` |
| `info_request` | 사용자 추가 입력 필요 시 | `{ agentId, content, uiSpec? }` |
| `task_complete` | 모든 처리 완료 | `{ agentId, content }` |
| `error` | 처리 실패 | `{ agentId, content }` |

`agentId`는 `'manager'`로 고정 (하위 에이전트 연결 시 변경).

---

## 5. 도구 정의

### 5.1 ToolHandler 인터페이스

```typescript
interface ToolHandler<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  execute(input: TInput, sessionId: string): Promise<TOutput>
}
```

**교체 원칙:** 현재 `ClaudeStubHandler`를 구현. 실제 에이전트 완성 시 `RedisAgentHandler`로 교체. Manager 코드 변경 없음.

### 5.2 도구 7개

| 도구명 | 담당 에이전트 | 입력 | 출력 |
|---|---|---|---|
| `plan_task` | xzawedPlanner | `{ intent, context }` | `{ steps, estimatedTime }` |
| `develop_code` | xzawedDeveloper | `{ plan, projectPath }` | `{ artifacts, summary }` |
| `design_ui` | xzawedDesigner | `{ requirements, stack }` | `{ spec, components }` |
| `run_tests` | xzawedTester | `{ artifacts, testTypes }` | `{ passed, failed, report }` |
| `build_project` | xzawedBuilder | `{ projectPath, target }` | `{ success, output, artifacts }` |
| `watch_changes` | xzawedWatcher | `{ projectPath, triggers }` | `{ watcherId, status }` |
| `security_audit` | xzawedSecurity | `{ artifacts, severity }` | `{ issues, score }` |

---

## 6. 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 |
| Claude SDK | `@anthropic-ai/sdk` (tool-calling) |
| Redis | `ioredis` |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm workspaces + Turborepo |

---

## 7. 환경 변수

```env
# Claude
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6

# Redis
REDIS_URL=redis://localhost:6379

# 서버
PORT=3001
MODE=local
```

포트 3001 사용 (Orchestrator 3000과 충돌 방지).

---

## 8. 테스트 범위

- `consumer.test.ts` — Redis 메시지 수신 및 파싱
- `producer.test.ts` — Redis 메시지 발행
- `runner.test.ts` — Claude tool-calling 루프 (mock)
- `tools/*.test.ts` — 각 도구 stub 동작 검증
- `session.store.test.ts` — 세션 상태 전이

---

## 9. 구현 제외 범위 (이번 스펙)

- 실제 하위 에이전트 연결 (모두 Claude stub)
- JWT 인증
- PostgreSQL 영속화
- MCP 서버 엔드포인트
