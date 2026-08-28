# CLAUDE.md — xzawedWatcher

## 프로젝트 개요

xzawedWatcher는 xzawed 멀티 에이전트 시스템의 **파일 감시 에이전트**다.
xzawedManager로부터 감시 요청을 받아 chokidar로 파일 변경을 감지하고 이벤트를 스트리밍한다.

**Claude API 미사용** — 순수 파일 시스템 이벤트 처리만 수행. `ANTHROPIC_API_KEY` 불필요. Claude를 쓰지 않으므로 에이전트 협업(AgentQuery 답변·교차질의)·도메인 지식 emit 대상에서 제외된다(`createCollaborativeHandler` 미적용).

## 구조

`src/` 트리 → [docs/services/watcher.md](../docs/services/watcher.md#architecture). **여기 복사하지 않는다** —
두 벌을 손으로 유지하다 양쪽이 다 낡았다(한쪽은 없는 파일을, 다른 쪽은 없는 테스트를 적고 있었다).
## Redis Streams 인터페이스

**Consumer Group:** `watcher-consumers`

```typescript
// 수신: manager:to-watcher:{sessionId}
interface ManagerToWatcherMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'watch_request' | 'stop_watch' | 'abort'
  payload: {
    projectPath: string
    triggers: string[]            // 상대경로 glob 패턴 (절대경로·상위 이동(`..` 세그먼트) 불가)
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

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

이 서비스 고유 변수만 적는다.

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `MAX_WATCHERS` | 선택 | `10` | 동시 감시 세션 최대 수 |
| `DEBOUNCE_MS` | 선택 | `300` | 파일 이벤트 디바운스 (ms) |

## 구현 참고사항

**보안 패턴**
- `triggers` 이중 차단: Zod `refine`(shared `isSafeRelativePath`) + `watcher.ts` 런타임 `filter` (defense-in-depth). **세그먼트 판정이다** — `includes('..')` 부분문자열 검사는 `patches/v1..v2/*` 같은 정상 glob 을 오거부한다
- chokidar `cwd` 옵션은 절대경로 항목에 적용되지 않으므로 Zod 단계에서 반드시 차단
- `followSymlinks: false` — 심볼릭 링크 추적 비활성화

**WatcherStore 동작**
- `add()`: `entries.size >= maxWatchers`이면 throw → 호출자(`watcher.ts`)가 즉시 watcher 닫기
- `remove()`: 타이머 전부 `clearTimeout` 후 watcher 닫기 (중지 후 이벤트 발생 방지)
- 빈 `triggers` → `['**/*']` fallback
- chokidar 옵션: `ignored: /(node_modules|\.git)/`, `ignoreInitial: true`

**테스트 패턴**
- `vi.hoisted()` + `vi.mock('chokidar', ...)` 패턴 (`watcher.test.ts` — 단위/에러경로)
- `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(300)` 디바운스 검증
- **실-FS 통합**(`watcher.realfs.test.ts`): chokidar를 **mock하지 않고** 실제 tmpdir로 glob 트리거의 생성/수정/삭제 감지→발행을 end-to-end 검증. chokidar 메이저 범프가 glob 지원을 제거(v4+)해 감시가 **무음 사망**하는 회귀를 CI가 잡는 가드(mock 테스트는 못 잡음). ⚠️ per-file 디바운스가 add+change를 병합하므로 생성 이벤트 타입(add/change)은 단언하지 않고 감지+distinct unlink만 검증. `ignoreInitial:true`라 chokidar `ready` 후 파일 생성 필수.

**Manager 연결:** `xzawedManager/packages/server/src/tools/watch-changes.ts` (`createWatchChangesHandler`)
