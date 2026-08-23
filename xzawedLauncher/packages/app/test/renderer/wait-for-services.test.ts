import { describe, it, expect, vi } from 'vitest'
import type { ServiceState } from '@xzawed/launcher-shared'
import { waitForAllRunning } from '../../src/renderer/src/lib/wait-for-services.js'

/**
 * **마법사가 완료로 넘어가지 못하던 이유.**
 *
 * `StepServices` 는 `docker compose up -d` 직후 상태를 **한 번만** 읽고
 * `states.every(s => s.status === 'running')` 이면 완료로 넘어갔다. 그런데
 *
 *   1. `up -d` 는 컨테이너를 **띄우고** 돌아온다 — healthy 를 기다리지 않는다.
 *   2. `getServiceStatuses` 는 `Health === 'healthy'` 여야 `running` 으로 친다.
 *
 * 그래서 그 시점의 앱 서비스는 항상 `starting` 이고, 조건은 결코 참이 되지 않았다.
 * (게다가 이전 compose 에는 앱 서비스 healthcheck 자체가 없어 `Health` 가 영영 빈
 * 문자열이었다 — `docker compose ps --format json` 으로 실측 확인.)
 *
 * 한 번 읽기를 폴링으로 바꾼다. 재시도 정책을 순수 함수로 떼어 여기서 고정한다.
 */

const svc = (name: string, status: ServiceState['status']): ServiceState =>
  ({ name, status } as ServiceState)

describe('waitForAllRunning', () => {
  it('전부 running 이면 즉시 성공한다', async () => {
    const get = vi.fn().mockResolvedValue([svc('redis', 'running'), svc('manager', 'running')])
    await expect(waitForAllRunning(get, { timeoutMs: 1000, intervalMs: 10 }))
      .resolves.toMatchObject({ ok: true })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('starting 이 running 이 될 때까지 다시 읽는다', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce([svc('manager', 'starting')])
      .mockResolvedValueOnce([svc('manager', 'starting')])
      .mockResolvedValue([svc('manager', 'running')])
    const r = await waitForAllRunning(get, { timeoutMs: 1000, intervalMs: 1 })
    expect(r.ok).toBe(true)
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('시간 내에 안 되면 ok:false 와 마지막 상태를 돌려준다', async () => {
    // 무한 대기는 마법사를 멈춰 세운다. 실패를 값으로 돌려줘 재시도 버튼이 뜨게 한다.
    const get = vi.fn().mockResolvedValue([svc('manager', 'starting'), svc('redis', 'running')])
    const r = await waitForAllRunning(get, { timeoutMs: 30, intervalMs: 5 })
    expect(r.ok).toBe(false)
    expect(r.states.map((s) => s.name)).toEqual(['manager', 'redis'])
  })

  it('error 상태는 기다리지 않고 즉시 실패한다', async () => {
    // exited 컨테이너는 폴링으로 나아지지 않는다. 타임아웃까지 붙잡아 두면
    // 사용자는 원인을 모른 채 30초를 본다.
    const get = vi.fn().mockResolvedValue([svc('manager', 'error'), svc('redis', 'running')])
    const r = await waitForAllRunning(get, { timeoutMs: 5000, intervalMs: 5 })
    expect(r).toMatchObject({ ok: false, failed: ['manager'] })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('빈 목록은 성공으로 치지 않는다', async () => {
    // `docker compose ps` 가 아무것도 못 읽으면 every() 는 공허하게 true 다.
    // 그 상태로 완료 화면을 띄우면 "다 됐다"는 거짓말이 된다.
    const get = vi.fn().mockResolvedValue([])
    const r = await waitForAllRunning(get, { timeoutMs: 30, intervalMs: 5 })
    expect(r.ok).toBe(false)
  })

  it('읽기가 던지면 삼키고 다시 시도한다', async () => {
    // docker 데몬이 잠깐 바쁠 수 있다. 일시적 오류로 마법사를 끝내지 않는다.
    const get = vi.fn()
      .mockRejectedValueOnce(new Error('docker busy'))
      .mockResolvedValue([svc('manager', 'running')])
    await expect(waitForAllRunning(get, { timeoutMs: 1000, intervalMs: 1 }))
      .resolves.toMatchObject({ ok: true })
  })
})
