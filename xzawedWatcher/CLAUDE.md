# CLAUDE.md — xzawedWatcher

## 프로젝트 개요

xzawedWatcher는 xzawed 멀티 에이전트 시스템의 **파일 감시 에이전트**다.
xzawedManager로부터 감시 요청을 받아 chokidar로 파일 변경을 감지하고 이벤트를 스트리밍한다.

**Claude API 미사용** — 순수 파일 시스템 이벤트 처리만 수행. `ANTHROPIC_API_KEY` 불필요.

**현재 상태: 구현 완료 (27/27 테스트 통과)**

## 핵심 명령어

```bash
# xzawedShared 먼저 빌드 필수
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedWatcher

pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <파일>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일 → dist/
```

## 디렉토리 구조

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, Consumer·Producer·WatcherStore·Watcher 초기화
├── config.ts             # 환경변수 검증 (Zod) — maxWatchers, debounceMs 포함
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3007)
├── watcher.ts            # chokidar 감시 로직 — per-file 디바운스, safeTriggers 이중 필터
├── watcher-store.ts      # WatcherStore — sessionId → WatchEntry Map 관리
├── executor.ts           # validatePath() — WORKSPACE_ROOT 경로 검증 (claude/ 없음)
├── types.ts              # FileEvent, ManagerToWatcherMessageSchema, WatcherToManagerMessage
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-watcher:{sessionId}
│   └── producer.ts       # watcher:to-manager:{sessionId} 발행
└── (claude/ 없음)
```

## Redis Streams 인터페이스

**Consumer Group:** `watcher-consumers`

```typescript
// 수신: manager:to-watcher:{sessionId}
interface ManagerToWatcherMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'watch_request' | 'stop_watch' | 'abort'
  payload: {
    projectPath: string
    triggers: string[]            // 상대경로 glob 패턴 (절대경로·'..' 포함 불가)
    debounceMs?: number           // 기본 300ms
    context: Record<string, unknown>
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: watcher:to-manager:{sessionId}
interface WatcherToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'watch_started' | 'file_changed' | 'watch_stopped' | 'error'
  payload: {
    watcherId?: string
    changes?: FileEvent[]
    content: string
  }
}

interface FileEvent { path: string; event: 'add' | 'change' | 'unlink'; timestamp: number }
```

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3007` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |
| `MAX_WATCHERS` | 선택 | `10` | 동시 감시 세션 최대 수 |
| `DEBOUNCE_MS` | 선택 | `300` | 파일 이벤트 디바운스 (ms) |

## 구현 참고사항

**보안 패턴**
- `triggers` 이중 차단: Zod `refine`(`!path.isAbsolute && !includes('..')`) + `watcher.ts` 런타임 `filter` (defense-in-depth)
- chokidar `cwd` 옵션은 절대경로 항목에 적용되지 않으므로 Zod 단계에서 반드시 차단
- `followSymlinks: false` — 심볼릭 링크 추적 비활성화

**WatcherStore 동작**
- `add()`: `entries.size >= maxWatchers`이면 throw → 호출자(`watcher.ts`)가 즉시 watcher 닫기
- `remove()`: 타이머 전부 `clearTimeout` 후 watcher 닫기 (중지 후 이벤트 발생 방지)
- 빈 `triggers` → `['**/*']` fallback
- chokidar 옵션: `ignored: /(node_modules|\.git)/`, `ignoreInitial: true`

**테스트 패턴**
- `vi.hoisted()` + `vi.mock('chokidar', ...)` 패턴
- `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(300)` 디바운스 검증

**Manager 연결:** `xzawedManager/packages/server/src/tools/watch-changes.ts` (`createWatchChangesHandler`)
