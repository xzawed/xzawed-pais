# xzawedDeveloper — 개발 에이전트

**역할:** xzawedManager로부터 코드 구현 요청을 받아 실제 파일을 생성·수정하고 결과를 반환한다.

**포트:** 3003 | **상태:** 구현 완료 (31/31 테스트)

---

## 소스 구조

```
src/
├── index.ts
├── config.ts
├── server.ts            # Fastify /health
├── developer.ts         # 개발 조율 로직
├── streams/
│   ├── consumer.ts      # manager:to-developer:{sessionId}
│   └── producer.ts      # developer:to-manager:{sessionId}
└── claude/
    └── runner.ts        # Anthropic SDK 호출
```

## Redis Streams 인터페이스

**Consumer Group:** `developer-consumers`

### 수신 (ManagerToDeveloperMessage)

```typescript
interface ManagerToDeveloperMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_request' | 'abort'
  payload: {
    plan: string             // 구현 지시 (자연어 계획)
    projectPath: string
    context: Record<string, unknown>
  }
}
```

### 발신 (DeveloperToManagerMessage)

```typescript
interface DeveloperToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_complete' | 'error'
  payload: {
    artifacts?: string[]     // 생성·수정된 파일 경로 목록
    summary?: string
    content: string
  }
}
```

## 보안 규칙

- `WORKSPACE_ROOT` 외부 경로 파일 쓰기 차단 (path traversal 방지)
- 파일 쓰기는 `WORKSPACE_ROOT` 하위 `projectPath`로 한정

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3003
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager 연결

`tools/develop-code.ts`는 RedisAgentHandler 기반으로 구현 완료.
