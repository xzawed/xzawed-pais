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
})
