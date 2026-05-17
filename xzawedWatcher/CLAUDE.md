# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedWatcher는 xzawed 멀티 에이전트 시스템의 **파일 감시 에이전트**다.
xzawedManager로부터 감시 요청을 받아 chokidar로 파일 변경을 감지하고 이벤트를 스트리밍한다.
**Claude API 미사용** — 순수 파일 시스템 이벤트 처리만 수행.

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
├── index.ts              # 진입점: Redis consumer 시작
├── config.ts             # 환경변수 검증 (maxWatchers, debounceMs)
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3007)
├── watcher.ts            # chokidar 감시 로직 (per-file 디바운스)
├── watcher-store.ts      # 활성 감시자 WatchEntry Map 관리
├── types.ts              # FileEvent, WatcherToManagerMessage 타입
├── streams/
│   ├── consumer.ts       # 구독: manager:to-watcher:{sessionId}
│   └── producer.ts       # 발행: watcher:to-manager:{sessionId}
└── (claude/ 없음 — Claude API 미사용)
```

### 데이터 흐름

1. Redis consumer → `watch_request` 수신
2. `watcher.ts` → `validatePath` 후 `chokidar.watch(triggers, { cwd })` 시작
3. `watcher-store.ts` → `WatchEntry`(watcherId, watcher, timers) 저장
4. 파일 이벤트 발생 → per-file 디바운스 타이머 → `file_changed` 발행
5. `stop_watch` / `abort` → `store.remove(sessionId)` → `watch_stopped` 발행

## Redis Streams 인터페이스

**Consumer Group:** `watcher-consumers`

```typescript
// 수신: manager:to-watcher:{sessionId}
interface ManagerToWatcherMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'watch_request' | 'stop_watch' | 'abort'
  payload: {
    projectPath: string
    triggers: string[]         // 감시할 glob 패턴
    debounceMs?: number        // 기본 300ms
    context: Record<string, unknown>
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

```env
REDIS_URL=redis://localhost:6379
PORT=3007
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
MAX_WATCHERS=10
DEBOUNCE_MS=300
```

## 구현 참고사항

- `WatcherStore.remove()`: 타이머 전부 `clearTimeout` 후 watcher 닫음 (중지 후 이벤트 방지)
- **`triggers` 보안**: `types.ts` Zod 스키마에서 절대경로·`..` 포함 패턴 차단. `watcher.ts`에서 chokidar 전달 전 이중 필터 적용 (defense-in-depth)
- chokidar의 `cwd` 옵션은 절대경로 watch 항목에 적용되지 않으므로 Zod 단계에서 반드시 차단해야 함
- 테스트: `vi.hoisted()` + `vi.mock('chokidar', ...)` 패턴, `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(300)` 디바운스 검증
- Manager 연결: `xzawedManager/packages/server/src/tools/watch-changes.ts` (`createWatchChangesHandler`)

## xzawed 생태계 연결

전체 suite: `f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\`
- 에이전트 간 통신: Redis Streams (ioredis), 포트 3002–3008
- 설계 스펙: `docs/services/watcher.md`
