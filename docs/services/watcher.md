# xzawedWatcher — 이슈 관리자

**역할:** 프로젝트 파일 시스템을 감시하고 변경 이벤트를 xzawedManager로 스트리밍한다. Claude API 미사용 — chokidar 기반 순수 파일 감시.

**포트:** 3007 | **상태:** 구현 완료 (26/26 테스트)

---

## 소스 구조

```
src/
├── index.ts
├── config.ts
├── server.ts            # Fastify /health
├── watcher.ts           # chokidar 감시 조율 로직
├── streams/
│   ├── consumer.ts      # manager:to-watcher:{sessionId}
│   └── producer.ts      # watcher:to-manager:{sessionId}
```

> Claude API를 사용하지 않는 유일한 에이전트.

## Redis Streams 인터페이스

**Consumer Group:** `watcher-consumers`

### 수신 (ManagerToWatcherMessage)

```typescript
interface ManagerToWatcherMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'watch_request' | 'stop_watch' | 'abort'
  payload: {
    projectPath: string
    patterns?: string[]          // glob 패턴 (기본: '**/*')
    ignorePatterns?: string[]    // 제외 패턴 (예: 'node_modules/**')
    context: Record<string, unknown>
  }
}
```

### 발신 (WatcherToManagerMessage)

```typescript
interface WatcherToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'watch_event' | 'watch_started' | 'watch_stopped' | 'error'
  payload: {
    events?: FileEvent[]
    content: string
  }
}

interface FileEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
  timestamp: number
}
```

## 제약 사항

- `MAX_WATCHERS` 환경변수로 동시 감시 세션 수 제한
- `WORKSPACE_ROOT` 외부 경로 감시 차단

## 환경 변수

```env
REDIS_URL=redis://localhost:6379
PORT=3007
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
MAX_WATCHERS=10
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager 연결

`tools/watch-changes.ts`의 `ClaudeStubHandler`를 `RedisAgentHandler`로 교체하면 연결 완료.
