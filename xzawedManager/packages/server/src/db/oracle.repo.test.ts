import { describe, it, expect, vi } from 'vitest'
import { OracleRepo } from './oracle.repo.js'
import { oracleIdFor } from './oracle.types.js'

function makeMockPool(opts: { selectRows?: unknown[]; scenarios?: unknown[] } = {}) {
  const defaultRow = { workflow_id: 'wf1', story_id: 's1', version: 1, status: 'pending', scenarios: opts.scenarios ?? [] }
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/SELECT .* FROM oracles/i.test(sql)) return Promise.resolve({ rows: opts.selectRows ?? [defaultRow] })
    if (/UPDATE oracles/i.test(sql)) return Promise.resolve({ rows: [] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect, query } as never, client, query, release, connect }
}
const callFor = (q: ReturnType<typeof vi.fn>, re: RegExp) => q.mock.calls.find((c) => re.test(String(c[0])))

describe('OracleRepo.approve (P3-2: SELECT FOR UPDATE→전이→UPDATE·pending 가드)', () => {
  it('단일 tx로 SELECT FOR UPDATE + UPDATE + events + outbox 후 COMMIT, outbox 스트림=manager:oracle:main', async () => {
    const m = makeMockPool()
    const res = await new OracleRepo(m.pool, () => 1000).approve('o1', 'h1')
    const verbs = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())
    expect(verbs[0]).toBe('BEGIN')
    expect(verbs[verbs.length - 1]).toBe('COMMIT')
    expect(callFor(m.query, /SELECT .* FROM oracles .* FOR UPDATE/i)).toBeTruthy()
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[1]).toBe('manager:oracle:main')   // 권고#1 outbox 단언 보존
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('멱등키 {wf}:oracle.approved:{id}:{ver}(version=SELECT row)', async () => {
    const m = makeMockPool({ selectRows: [{ workflow_id: 'wf1', story_id: 's1', version: 3, status: 'pending', scenarios: [] }] })
    await new OracleRepo(m.pool, () => 1000).approve('o1', 'h1')
    expect((callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[])[6]).toBe('wf1:oracle.approved:o1:3')
  })

  it('status≠pending(approved·superseded·미존재)이면 null·이벤트 미적재(blocker#8)', async () => {
    for (const rows of [[], [{ workflow_id: 'wf1', story_id: 's1', version: 1, status: 'approved', scenarios: [] }], [{ workflow_id: 'wf1', story_id: 's1', version: 1, status: 'superseded', scenarios: [] }]]) {
      const m = makeMockPool({ selectRows: rows })
      expect(await new OracleRepo(m.pool, () => 1).approve('o1', 'h')).toBeNull()
      expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
    }
  })

  it('drafted→human_approved 일괄 전이, rejected/human_approved 불변', async () => {
    const scenarios = [
      { id: 'a', title: '', given: [], when: '', thenSteps: [], status: 'drafted' },
      { id: 'b', title: '', given: [], when: '', thenSteps: [], status: 'human_approved' },
      { id: 'c', title: '', given: [], when: '', thenSteps: [], status: 'rejected' },
    ]
    const m = makeMockPool({ scenarios })
    await new OracleRepo(m.pool, () => 1000).approve('o1', 'h1')
    const written = JSON.parse((callFor(m.query, /UPDATE oracles/i)![1] as unknown[])[2] as string) as Array<{ id: string; status: string }>
    expect(written.find((s) => s.id === 'a')?.status).toBe('human_approved')
    expect(written.find((s) => s.id === 'b')?.status).toBe('human_approved')
    expect(written.find((s) => s.id === 'c')?.status).toBe('rejected')
  })

  it('drafted 없으면 scenarios 불변(no-op)', async () => {
    const scenarios = [{ id: 'a', title: '', given: [], when: '', thenSteps: [], status: 'human_approved' }]
    const m = makeMockPool({ scenarios })
    await new OracleRepo(m.pool, () => 1000).approve('o1', 'h1')
    expect(JSON.parse((callFor(m.query, /UPDATE oracles/i)![1] as unknown[])[2] as string)).toEqual(scenarios)
  })

  it('불량 scenarios JSON이면 parse throw→ROLLBACK·UPDATE/events/outbox 미적재·client release(N2)', async () => {
    // status=pending 가드는 통과하나 scenarios가 OracleScenarioSchema 위반(id 없음) → parse가 tx 내에서 throw.
    const m = makeMockPool({ selectRows: [{ workflow_id: 'wf1', story_id: 's1', version: 1, status: 'pending', scenarios: [{ title: 'no-id' }] }] })
    await expect(new OracleRepo(m.pool, () => 1000).approve('o1', 'h1')).rejects.toThrow()
    expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
    expect(callFor(m.query, /COMMIT/i)).toBeUndefined()
    expect(callFor(m.query, /UPDATE oracles/i)).toBeUndefined()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
    expect(callFor(m.query, /INSERT INTO manager_outbox/i)).toBeUndefined()
    expect(m.release).toHaveBeenCalled()   // finally의 client.release() 보장
  })
})

describe('OracleRepo.upsertDraft (P3-2 멱등)', () => {
  it('oracleId=oracleIdFor(wf,storyId)로 pending INSERT ... ON CONFLICT(version 불변·status=pending 가드)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = { query } as never
    await new OracleRepo(pool).upsertDraft({
      workflowId: 'wf1', storyId: 's1',
      scenarios: [{ id: 's1-sc1', title: '', given: [], when: '', thenSteps: [], status: 'drafted' }],
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
    const scenarios = [{ id: 's2-sc1', title: 't', given: ['g'], when: 'w', thenSteps: ['x'], status: 'drafted' as const }]
    const coverage = { acA: ['s2-sc1'] }
    await new OracleRepo(pool).upsertDraft({ workflowId: 'wf2', storyId: 's2', scenarios, coverage })
    const args = query.mock.calls[0]![1] as unknown[]
    expect(JSON.parse(args[3] as string)).toEqual(scenarios)
    expect(JSON.parse(args[4] as string)).toEqual(coverage)
  })
})
