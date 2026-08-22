import type { ConsumerLike } from '@xzawed/agent-streams'
import type { WatcherStore } from './watcher-store.js'

/** 세션 소비자가 붙잡는 것 중 Redis 연결 외에 정리가 필요한 최소 표면. */
interface SessionConsumer {
  start(sessionId: string): Promise<void>
  stop(): void
  close(): Promise<void>
}

/**
 * 세션 소비자에 Watcher 자원 회수를 묶는다.
 *
 * `WatcherStore`는 프로세스 전역이라 세션 소비자와 생명주기가 분리돼 있다. 명시적으로
 * 묶지 않으면 세션이 끝나도 그 세션의 chokidar FSWatcher와 디바운스 타이머가
 * SIGTERM까지 살아남는다 — 다른 6개 에이전트에는 없는 Watcher 고유의 누수다.
 *
 * `store.remove`를 **먼저** 부른다. 감시 종료 중 발생할 수 있는 발행이 아직
 * 살아있는 Redis 연결을 쓸 수 있게 하기 위해서다. `remove`는 항목이 없으면
 * `undefined`를 반환하므로 멱등이고, `close`가 두 번 불려도 안전하다.
 */
export function withWatcherCleanup(
  consumer: SessionConsumer,
  store: Pick<WatcherStore, 'remove'>,
  sessionId: string,
): ConsumerLike {
  return {
    start: (sid: string) => consumer.start(sid),
    stop: () => consumer.stop(),
    close: async () => {
      await store.remove(sessionId)
      await consumer.close()
    },
  }
}
