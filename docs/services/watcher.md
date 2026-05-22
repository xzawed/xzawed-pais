# xzawedWatcher — 파일 변경 감시 에이전트

**역할:** 프로젝트 파일 시스템을 감시하고 변경 이벤트를 xzawedManager로 스트리밍한다. Claude API 미사용 — chokidar 기반 순수 파일 감시.

**포트:** 3007 | **상태:** 구현 완료 (27/27 테스트)

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
    triggers: string[]           // 상대경로 glob 패턴 (절대경로·'..' 포함 불가)
    debounceMs?: number          // 이벤트 디바운스 ms (기본: 300)
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
  type: 'watch_started' | 'file_changed' | 'watch_stopped' | 'error'
  payload: {
    watcherId?: string
    changes?: FileEvent[]
    content: string
  }
}

interface FileEvent {
  path: string
  event: 'add' | 'change' | 'unlink'
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
DEBOUNCE_MS=300
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager 연결

`tools/watch-changes.ts`는 RedisAgentHandler 기반으로 구현 완료.
