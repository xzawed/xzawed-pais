import { describe, it, expect, vi } from 'vitest'
import { OracleRepo } from './oracle.repo.js'
import { oracleIdFor } from './oracle.types.js'

function makeMockPool(opts: { updateRows?: unknown[] } = {}) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/UPDATE oracles/i.test(sql)) return Promise.resolve({ rows: opts.updateRows ?? [{ workflow_id: 'wf1', story_id: 's1', version: 1 }] })
    if (/SELECT .* FROM oracles/i.test(sql)) return Promise.resolve({ rows: [] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect, query } as never, client, query, release, connect }
}
const callFor = (q: ReturnType<typeof vi.fn>, re: RegExp) => q.mock.calls.find((c) => re.test(String(c[0])))

describe('OracleRepo.approve', () => {
  it('단일 tx로 oracles UPDATE + manager_events + manager_outbox INSERT 후 COMMIT', async () => {
    const m = makeMockPool()
    const res = await new OracleRepo(m.pool, () => 1000).approve('o1', 'human-1')
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs[0]).toBe('BEGIN')
    expect(verbs[verbs.length - 1]).toBe('COMMIT')
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeTruthy()
    expect(callFor(m.query, /INSERT INTO manager_outbox/i)).toBeTruthy()
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('멱등키를 {wf}:oracle.approved:{oracleId}:{version}로 고정', async () => {
    const m = makeMockPool({ updateRows: [{ workflow_id: 'wf1', story_id: 's1', version: 3 }] })
    await new OracleRepo(m.pool, () => 1000).approve('o1', 'human-1')
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[6]).toBe('wf1:oracle.approved:o1:3') // idempotency_key
  })

  it('outbox 스트림은 manager:oracle:main', async () => {
    const m = makeMockPool()
    await new OracleRepo(m.pool, () => 1000).approve('o1', 'human-1')
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[1]).toBe('manager:oracle:main')
  })

  it('미존재·이미 approved(UPDATE 0행)면 null 반환·이벤트 미적재', async () => {
    const m = makeMockPool({ updateRows: [] })
    const res = await new OracleRepo(m.pool, () => 1000).approve('missing', 'human-1')
    expect(res).toBeNull()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
  })
})

describe('OracleRepo.upsertDraft (P3-2 멱등)', () => {
  it('oracleId=oracleIdFor(wf,storyId)로 pending INSERT ... ON CONFLICT(version 불변·status=pending 가드)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = { query } as never
    await new OracleRepo(pool).upsertDraft({
      workflowId: 'wf1', storyId: 's1',
      scenarios: [{ id: 's1-sc1', title: '', given: [], when: '', then: [], status: 'drafted' }],
      coverage: { ac1: ['s1-sc1'] },
    })
    const sql = String(query.mock.calls[0]![0])
    const args = query.mock.calls[0]![1] as unknown[]
    // D1: oracleId는 oracleIdFor 해시 파생(리터럴 'oracle-wf1-s1' 아님)
    expect(args[0]).toBe(oracleIdFor('wf1', 's1'))
    expect(args[1]).toBe('wf1')
    expect(args[2]).toBe('s1')
    expect(sql).toMatch(/ON CONFLICT \(oracle_id\) DO UPDATE/i)
    expect(sql).toMatch(/WHERE oracles\.status\s*=\s*'pending'/i)   // approved 보존
    expect(sql).not.toMatch(/version\s*=\s*oracles\.version\s*\+\s*1/i) // version 불변
    expect(sql).toMatch(/INSERT INTO oracles/i)
  })

  it('scenarios·coverage를 JSON 직렬화해 바인딩', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = { query } as never
    const scenarios = [{ id: 's2-sc1', title: 't', given: ['g'], when: 'w', then: ['x'], status: 'drafted' as const }]
    const coverage = { acA: ['s2-sc1'] }
    await new OracleRepo(pool).upsertDraft({ workflowId: 'wf2', storyId: 's2', scenarios, coverage })
    const args = query.mock.calls[0]![1] as unknown[]
    expect(JSON.parse(args[3] as string)).toEqual(scenarios)
    expect(JSON.parse(args[4] as string)).toEqual(coverage)
  })
})
