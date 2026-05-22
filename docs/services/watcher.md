# xzawedWatcher — 파일 변경 감시 에이전트

프로젝트 파일 시스템을 chokidar로 감시하고 변경 이벤트를 xzawedManager로 스트리밍한다. Claude API를 사용하지 않는 유일한 에이전트다.

**포트:** 3007 | **상태:** 구현 완료 (27/27 테스트)

---

## Overview

xzawedWatcher는 세션 단위로 독립적인 파일 감시자를 관리한다. `WatcherStore`가 활성 감시자 목록을 `sessionId → WatchEntry` Map으로 관리하며, `MAX_WATCHERS`로 동시 감시 세션 수를 제한한다. 파일 이벤트는 파일별 디바운스 타이머를 통해 중복 이벤트를 합산한 후 `file_changed`로 발행한다. `triggers` glob 패턴은 Zod 스키마 단계에서 절대경로와 `..` 포함을 차단하며, `watcher.ts`에서 이중 필터를 적용한다.

**입력:** `manager:to-watcher:{sessionId}` 스트림의 `watch_request` 메시지  
**출력:** `watcher:to-manager:{sessionId}` 스트림의 `watch_started`, `file_changed`, `watch_stopped`, `error` 메시지

---

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
    triggers: string[]            // 상대경로 glob 패턴 (절대경로·'..' 포함 불가)
    debounceMs?: number           // 이벤트 디바운스 ms (기본: 300)
    context: Record<string, unknown>
    userContext?: {
      userId: string
      projectId: string
      workspaceRoot: string
      githubRepo?: { owner: string; repo: string; branch: string }
    }
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
    watcherId?: string            // 감시자 UUID (watch_started, file_changed, watch_stopped)
    changes?: FileEvent[]         // 변경된 파일 목록 (file_changed)
    content: string
  }
}

interface FileEvent {
  path: string
  event: 'add' | 'change' | 'unlink'
  timestamp: number
}
```

---

## Architecture

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, Consumer·Producer·Watcher·Store 초기화
├── config.ts             # 환경변수 검증 (Zod) — maxWatchers, debounceMs 포함
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3007)
├── watcher.ts            # chokidar 감시 로직 — per-file 디바운스, safeTriggers 이중 필터
├── watcher-store.ts      # WatcherStore 클래스 — sessionId → WatchEntry Map 관리
├── executor.ts           # validatePath() — WORKSPACE_ROOT 경로 검증 (claude/ 없음)
├── types.ts              # FileEvent, ManagerToWatcherMessageSchema, WatcherToManagerMessage 정의
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-watcher:{sessionId} 구독
│   └── producer.ts       # watcher:to-manager:{sessionId} 발행
└── (claude/ 없음 — Claude API 미사용)
```

### 데이터 흐름

1. `consumer.ts` → `watch_request` 수신, Zod 스키마 검증 (`triggers` 패턴 차단 포함)
2. `watcher.ts` → `validatePath(projectPath)` 경로 검증
3. `triggers` 이중 필터: `filter(t => !path.isAbsolute(t) && !t.includes('..'))`
4. `chokidar.watch(safeTriggers, { cwd: validPath, followSymlinks: false })` 시작
5. `WatcherStore.add(sessionId, { watcherId, watcher, timers })` — 한도 초과 시 즉시 throw 후 watcher 닫기
6. `watch_started` 발행 후 파일 이벤트 대기
7. 이벤트 발생 → per-file `setTimeout(debounceMs)` → 기존 타이머 갱신 → 만료 시 `file_changed` 발행
8. `stop_watch` / `abort` → `WatcherStore.remove(sessionId)` → 타이머 전부 취소, watcher 닫기 → `watch_stopped` 발행

### WatcherStore

```typescript
class WatcherStore {
  constructor(maxWatchers: number)
  add(sessionId: string, entry: WatchEntry): void   // 한도 초과 시 throw
  get(sessionId: string): WatchEntry | undefined
  async remove(sessionId: string): Promise<WatchEntry | undefined>
  async stopAll(): Promise<void>
  get size(): number
}

interface WatchEntry {
  watcherId: string
  watcher: { close(): Promise<void> }
  timers: Map<string, ReturnType<typeof setTimeout>>
}
```

`remove()`: 타이머 전부 `clearTimeout` 후 watcher를 닫아 중지 후 이벤트 발생을 방지한다.

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3007` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 (`local` \| `remote`) |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |
| `MAX_WATCHERS` | 선택 | `10` | 동시 감시 세션 최대 수 |
| `DEBOUNCE_MS` | 선택 | `300` | 파일 이벤트 디바운스 (ms) |

> `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` 불필요 — Claude API 미사용.

---

## Development

```bash
# 의존성 설치 (xzawedShared 먼저 빌드 필수)
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedWatcher
pnpm install

pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 실행
pnpm test <파일>   # 단일 파일
pnpm build         # TypeScript 컴파일 → dist/
```

### 구현 참고사항

- `triggers` 보안: Zod `refine` 검증 + `watcher.ts` 런타임 필터 이중 적용 (defense-in-depth). chokidar의 `cwd` 옵션은 절대경로 항목에 적용되지 않으므로 Zod 단계에서 반드시 차단해야 한다
- 빈 `triggers` 처리: `safeTriggers`가 빈 배열이면 `['**/*']`로 fallback
- chokidar 옵션: `ignored: /(node_modules|\.git)/`, `ignoreInitial: true`, `followSymlinks: false`
- 테스트: `vi.hoisted()` + `vi.mock('chokidar', ...)` 패턴, `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(300)` 디바운스 검증

---

## Related

- [xzawedShared CLAUDE.md](../../xzawedShared/CLAUDE.md) — BaseConsumer, validateWorkspaceRoot
- [xzawedManager tools/watch-changes.ts](../../xzawedManager/packages/server/src/tools/watch-changes.ts)
- [서비스 목록](../README.md)
