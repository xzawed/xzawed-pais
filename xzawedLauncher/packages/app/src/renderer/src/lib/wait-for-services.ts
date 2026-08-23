import type { ServiceState } from '@xzawed/launcher-shared'

/**
 * 서비스 전체가 `running` 이 될 때까지 상태를 다시 읽는다.
 *
 * `docker compose up -d` 는 컨테이너를 **띄우고** 돌아온다 — healthy 를 기다리지 않는다.
 * 그런데 `getServiceStatuses` 는 `Health === 'healthy'` 여야 `running` 으로 치므로,
 * `up -d` 직후 한 번만 읽으면 앱 서비스는 언제나 `starting` 이다. 마법사가 완료로
 * 넘어가지 못하던 이유가 이것이다.
 *
 * 재시도 정책을 순수 함수로 떼어 둔다 — 컴포넌트 안에 두면 검사할 방법이 없다.
 */

export interface WaitResult {
  ok: boolean
  states: ServiceState[]
  /** `error` 로 주저앉은 서비스. 있으면 기다려도 나아지지 않는다. */
  failed: string[]
}

export interface WaitOptions {
  timeoutMs: number
  intervalMs: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function waitForAllRunning(
  getStatus: () => Promise<ServiceState[]>,
  { timeoutMs, intervalMs }: WaitOptions,
): Promise<WaitResult> {
  const deadline = Date.now() + timeoutMs
  let states: ServiceState[] = []

  for (;;) {
    try {
      states = await getStatus()
    } catch {
      // docker 데몬이 잠깐 바쁠 수 있다. 일시적 오류로 마법사를 끝내지 않는다.
      states = []
    }

    // exited 컨테이너는 폴링으로 나아지지 않는다. 타임아웃까지 붙잡아 두면
    // 사용자는 원인을 모른 채 대기 화면만 본다.
    const failed = states.filter((s) => s.status === 'error').map((s) => s.name)
    if (failed.length > 0) return { ok: false, states, failed }

    // 빈 목록에 `every` 를 걸면 공허하게 true 다 — "다 됐다"는 거짓말이 된다.
    if (states.length > 0 && states.every((s) => s.status === 'running')) {
      return { ok: true, states, failed: [] }
    }

    if (Date.now() >= deadline) return { ok: false, states, failed: [] }
    await sleep(intervalMs)
  }
}
