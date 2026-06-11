import { describe, it, expect, vi } from 'vitest'
import { createOutboxPublish } from './outbox-publish.js'

function makeMockPool() {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect } as never, query, release, connect }
}
const callFor = (q: ReturnType<typeof vi.fn>, re: RegExp) => q.mock.calls.find((c) => re.test(String(c[0])))

const env = {
  eventId: '11111111-1111-1111-1111-111111111111',
  correlationId: 'wf-1', causationId: null, workflowId: 'wf-1',
  stepId: 'decomposition.emitted', attemptId: 0,
  idempotencyKey: 'wf-1:decomposition.emitted:0', occurredAt: 1000,
}
const message = { envelope: env, type: 'decomposition.emitted', payload: { workPackages: [{ id: 'a' }] } }

describe('createOutboxPublish — 트랜잭셔널 아웃박스 발행(M5)', () => {
  it('manager_events + manager_outbox를 단일 tx(BEGIN…COMMIT)로 적재하고 eventId 반환', async () => {
    const m = makeMockPool()
    const out = await createOutboxPublish(m.pool)('manager:decomposition:main', message)

    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs[0]).toBe('BEGIN')
    expect(verbs[verbs.length - 1]).toBe('COMMIT')
    expect(out).toBe(env.eventId)
    expect(m.release).toHaveBeenCalled()
  })

  it('manager_events에 봉투 필드(event_id·session_id=workflowId·type·payload·correlation·causation·idempotency·actor·occurred)를 매핑', async () => {
    const m = makeMockPool()
    await createOutboxPublish(m.pool, 'task-manager')('manager:decomposition:main', message)
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[0]).toBe(env.eventId)
    expect(ev[1]).toBe('wf-1')                                   // session_id = workflowId
    expect(ev[2]).toBe('decomposition.emitted')                 // event_type
    expect(JSON.parse(ev[3] as string)).toEqual({ workPackages: [{ id: 'a' }] })
    expect(ev[6]).toBe('wf-1:decomposition.emitted:0')          // idempotency_key
    expect(ev[7]).toBe('task-manager')                          // actor
    expect(ev[8]).toBe(1000)                                    // occurred_at
  })

  it('manager_outbox에 (event_id, stream, 원본 message)를 적재 — relay가 그 stream으로 발행', async () => {
    const m = makeMockPool()
    await createOutboxPublish(m.pool)('manager:decomposition:main', message)
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[0]).toBe(env.eventId)
    expect(ob[1]).toBe('manager:decomposition:main')
    expect(JSON.parse(ob[2] as string)).toEqual(message)        // 봉투+type+payload 보존
  })

  it('payload 미존재 메시지는 빈 객체로 적재(견고)', async () => {
    const m = makeMockPool()
    await createOutboxPublish(m.pool)('s', { envelope: env, type: 'decomposition.inconsistent' })
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(JSON.parse(ev[3] as string)).toEqual({})
  })

  it('INSERT 실패 시 ROLLBACK하고 throw하며 client를 release한다', async () => {
    const m = makeMockPool()
    m.query.mockImplementation((sql: string) => {
      if (/INSERT INTO manager_outbox/i.test(sql)) return Promise.reject(new Error('boom'))
      return Promise.resolve({ rows: [] })
    })
    await expect(createOutboxPublish(m.pool)('s', message)).rejects.toThrow('boom')
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs).toContain('ROLLBACK')
    expect(verbs).not.toContain('COMMIT')
    expect(m.release).toHaveBeenCalled()
  })
})
