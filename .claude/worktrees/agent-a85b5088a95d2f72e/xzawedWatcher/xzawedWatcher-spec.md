# CLAUDE.md — xzawedWatcher

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedWatcher는 xzawed 멀티 에이전트 시스템의 **파일 감시 에이전트**다.
xzawedManager로부터 감시 설정을 받아 파일 시스템 변경을 감지하고 변경 이벤트를 실시간으로 보고한다.

## 역할 및 책임

- 지정된 경로의 파일 시스템 변경 감지 (생성·수정·삭제)
- 변경 이벤트 필터링 (glob 패턴)
- 변경 이벤트를 Manager에 실시간 보고
- 감시 중단/재시작 관리

## Redis Streams 인터페이스

**수신:** `manager:to-watcher:{sessionId}`
**발신:** `watcher:to-manager:{sessionId}`
**Consumer Group:** `watcher-consumers`

### 수신 메시지 (ManagerToWatcherMessage)

```typescript
interface ManagerToWatcherMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'watch_request' | 'stop_watch' | 'abort'
  payload: {
    projectPath: string
    triggers: string[]                // glob 패턴 배열 (예: ['**/*.ts', '!node_modules/**'])
    debounceMs?: number               // 기본값 300ms
    context: Record<string, unknown>
  }
}
```

### 발신 메시지 (WatcherToManagerMessage)

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

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health`) |
| 파일 감시 | `chokidar` |
| Redis | `ioredis` |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm |

## 환경 변수

```env
REDIS_URL=redis://localhost:6379
PORT=3007
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
MAX_WATCHERS=50
```

`ANTHROPIC_API_KEY` 불필요 — Claude를 사용하지 않는 순수 이벤트 서비스.

## 레포 초기 구조

```
xzawedWatcher/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts
    ├── config.ts
    ├── server.ts
    ├── streams/
    │   ├── consumer.ts   # manager:to-watcher:{sessionId}
    │   └── producer.ts   # watcher:to-manager:{sessionId}
    ├── watcher-store.ts  # 활성 감시 인스턴스 관리
    └── watcher.ts        # chokidar 감시 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `watch_request` 수신
2. chokidar로 지정 경로 감시 시작
3. 파일 변경 시 `file_changed` 이벤트 발신 (디바운스 적용)
4. `stop_watch` 수신 시 감시 중단 및 `watch_stopped` 발신

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## 보안 고려사항

- `WORKSPACE_ROOT` 외부 경로 감시 차단
- 최대 동시 감시 인스턴스 제한 (`MAX_WATCHERS`)
- 심볼릭 링크 탈출 방지

## xzawedManager와의 연결

xzawedManager의 `watch_changes` 도구가 이 서비스로 위임된다.
Manager의 `tools/watch-changes.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.
