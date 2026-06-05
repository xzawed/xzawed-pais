import { describe, it, expect, vi } from 'vitest'
import { OutboxRelay } from './outbox-relay.js'

function makeDeps(pendingRows: Array<{ id: number; stream: string; message: unknown }>) {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: pendingRows }) // SELECT pending
    .mockResolvedValue({ rows: [] })              // UPDATE 등
  const pool = { query } as never
  const publish = vi.fn().mockResolvedValue(undefined)
  const producer = { publishRaw: publish } as never
  return { pool, producer, publish, query }
}

describe('OutboxRelay.pollOnce', () => {
  it('미발행 row를 발행하고 published_at을 설정한다', async () => {
    const d = makeDeps([{ id: 1, stream: 'manager:events:s1', message: { hello: 'world' } }])
    const relay = new OutboxRelay(d.pool, d.producer)
    await relay.pollOnce()
    expect(d.publish).toHaveBeenCalledWith('manager:events:s1', { hello: 'world' })
    const updated = d.query.mock.calls.find((c) => /UPDATE manager_outbox SET published_at/i.test(String(c[0])))
    expect(updated).toBeTruthy()
  })

  it('발행 실패 시 published_at을 설정하지 않고 attempts만 올린다(at-least-once)', async () => {
    const d = makeDeps([{ id: 1, stream: 's', message: {} }])
    d.publish.mockRejectedValueOnce(new Error('redis down'))
    const relay = new OutboxRelay(d.pool, d.producer)
    await relay.pollOnce() // throw 없이 진행
    const published = d.query.mock.calls.find((c) => /SET published_at/i.test(String(c[0])))
    const attempts = d.query.mock.calls.find((c) => /SET attempts/i.test(String(c[0])))
    expect(published).toBeFalsy()
    expect(attempts).toBeTruthy()
  })

  it('발행 성공 후 published_at UPDATE 실패 시 published로 표시하지 않고 attempts++(다음 틱 재발행)', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, stream: 's', message: {} }] }) // SELECT
      .mockRejectedValueOnce(new Error('update fail')) // UPDATE published_at 실패
      .mockResolvedValue({ rows: [] }) // attempts UPDATE
    const pool = { query } as never
    const publish = vi.fn().mockResolvedValue(undefined)
    const relay = new OutboxRelay(pool, { publishRaw: publish } as never)
    await relay.pollOnce() // throw 없이
    expect(publish).toHaveBeenCalled()
    const attempts = query.mock.calls.find((c) => /SET attempts/i.test(String(c[0])))
    expect(attempts).toBeTruthy() // 미published 유지 → 재발행 대상
  })

  it('재진입 가드: 진행 중인 pollOnce가 있으면 두 번째 호출을 건너뛴다(틱 겹침 중복 차단)', async () => {
    let resolveSelect: (v: unknown) => void = () => {}
    const query = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveSelect = r })) // 첫 SELECT 보류
      .mockResolvedValue({ rows: [] })
    const pool = { query } as never
    const relay = new OutboxRelay(pool, { publishRaw: vi.fn() } as never)
    const p1 = relay.pollOnce() // 진행 시작(SELECT에서 대기)
    const p2 = relay.pollOnce() // 재진입 — 즉시 건너뛰어야 함
    await p2
    expect(query).toHaveBeenCalledTimes(1) // 두 번째는 SELECT를 하지 않음
    resolveSelect({ rows: [] })
    await p1
  })
})
