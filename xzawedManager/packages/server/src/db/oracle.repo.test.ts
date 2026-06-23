import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { OracleRepo } from './oracle.repo.js'
import { oracleIdFor } from './oracle.types.js'

function mockPool(rows: unknown[]): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool
}

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

  it('invariant도 drafted→human_approved 전이(F5·rejected/human_approved 불변)', async () => {
    const m = makeMockPool({ selectRows: [{
      workflow_id: 'wf1', story_id: 's1', version: 1, status: 'pending', scenarios: [],
      invariants: [
        { id: 'i1', statement: 's', domain: 'd', property: 'p', status: 'drafted' },
        { id: 'i2', statement: 's2', domain: 'd2', property: 'p2', status: 'rejected' },
        { id: 'i3', statement: 's3', domain: 'd3', property: 'p3', status: 'human_approved' },
      ],
    }] })
    await new OracleRepo(m.pool, () => 1000).approve('o1', 'h1')
    const updateCall = callFor(m.query, /UPDATE oracles/i)!
    expect(String(updateCall[0])).toMatch(/invariants\s*=\s*\$\d/i) // UPDATE가 invariants 컬럼 갱신
    const writtenInv = JSON.parse((updateCall[1] as unknown[])[4] as string) as Array<{ id: string; status: string }>
    expect(writtenInv.find((i) => i.id === 'i1')?.status).toBe('human_approved') // drafted→전이
    expect(writtenInv.find((i) => i.id === 'i2')?.status).toBe('rejected') // 불변
    expect(writtenInv.find((i) => i.id === 'i3')?.status).toBe('human_approved') // 불변
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

  it('scenarios·invariants·coverage를 JSON 직렬화해 바인딩(invariants 미전달 → [])', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = { query } as never
    const scenarios = [{ id: 's2-sc1', title: 't', given: ['g'], when: 'w', thenSteps: ['x'], status: 'drafted' as const }]
    const coverage = { acA: ['s2-sc1'] }
    await new OracleRepo(pool).upsertDraft({ workflowId: 'wf2', storyId: 's2', scenarios, coverage })
    const args = query.mock.calls[0]![1] as unknown[]
    expect(JSON.parse(args[3] as string)).toEqual(scenarios)
    expect(JSON.parse(args[4] as string)).toEqual([]) // F5: invariants 미전달 → []
    expect(JSON.parse(args[5] as string)).toEqual(coverage) // coverage는 invariants 뒤로 이동
  })

  it('invariants를 INSERT 컬럼·직렬화 파라미터로 영속(F5)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = { query } as never
    const invariants = [{ id: 's1-inv1', statement: 'bal>=0', domain: 'a', property: 'p', status: 'drafted' as const }]
    await new OracleRepo(pool).upsertDraft({ workflowId: 'wf1', storyId: 's1', scenarios: [], coverage: {}, invariants })
    const sql = String(query.mock.calls[0]![0])
    const args = query.mock.calls[0]![1] as unknown[]
    expect(sql).toMatch(/invariants/i)
    expect(sql).toMatch(/invariants\s*=\s*EXCLUDED\.invariants/i)
    expect(JSON.parse(args[4] as string)).toEqual(invariants)
  })
})

describe('OracleRepo golden freeze (Slice 1)', () => {
  const gold = (over: Record<string, unknown>) => ({ id: 'g', inputFixture: 'i', normalizedOutput: 'o', normalizers: [], frozenAt: '', frozenBy: null, fromDecision: null, version: 1, ...over })

  it('approvedGoldensForStory는 frozenBy!=null golden만 반환(N7)', async () => {
    const repo = new OracleRepo(mockPool([{ golden_refs: [gold({ id: 'g1', frozenBy: 'po', frozenAt: 't' }), gold({ id: 'g2', frozenBy: null })] }]))
    const goldens = await repo.approvedGoldensForStory('wf', 's1')
    expect(goldens?.length).toBe(1)
    expect(goldens?.[0].id).toBe('g1')
  })

  it('approvedGoldensForStory는 frozen golden 0이면 null(전부 unfrozen)', async () => {
    const repo = new OracleRepo(mockPool([{ golden_refs: [gold({ id: 'g2', frozenBy: null })] }]))
    expect(await repo.approvedGoldensForStory('wf', 's1')).toBeNull()
  })

  it('freezeGoldensByWorkflow는 unfrozen golden을 UPDATE로 freeze(frozen 카운트)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ oracle_id: 'o1', golden_refs: [gold({ id: 'g1', frozenBy: null }), gold({ id: 'g2', frozenBy: 'alice', frozenAt: 't0' })] }] })
    const repo = new OracleRepo({ query } as never, () => 1000)
    const res = await repo.freezeGoldensByWorkflow('wf', 'po')
    expect(res.frozen).toBe(1) // g1만 전이(g2는 이미 frozen)
    const update = query.mock.calls.find((c) => /UPDATE oracles SET golden_refs/i.test(String(c[0])))!
    const written = JSON.parse((update[1] as unknown[])[1] as string) as Array<{ id: string; frozenBy: string | null }>
    expect(written.find((g) => g.id === 'g1')?.frozenBy).toBe('po')
    expect(written.find((g) => g.id === 'g2')?.frozenBy).toBe('alice')
  })

  it('freezeGoldensByWorkflow는 변경 없으면 UPDATE 미실행(멱등)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ oracle_id: 'o1', golden_refs: [gold({ id: 'g1', frozenBy: 'po', frozenAt: 't' })] }] })
    const repo = new OracleRepo({ query } as never, () => 1000)
    const res = await repo.freezeGoldensByWorkflow('wf', 'po')
    expect(res.frozen).toBe(0)
    expect(query.mock.calls.some((c) => /UPDATE oracles/i.test(String(c[0])))).toBe(false)
  })

  it('unfrozenGoldenCount는 미freeze golden 총 개수', async () => {
    expect(await new OracleRepo(mockPool([{ golden_refs: [gold({ id: 'a', frozenBy: null }), gold({ id: 'b', frozenBy: null }), gold({ id: 'c', frozenBy: 'po', frozenAt: 't' })] }])).unfrozenGoldenCount('wf')).toBe(2)
    expect(await new OracleRepo(mockPool([{ golden_refs: [gold({ frozenBy: 'po', frozenAt: 't' })] }])).unfrozenGoldenCount('wf')).toBe(0)
  })
})

describe('OracleRepo.approvedOracleForStory', () => {
  it('returns human_approved scenarios + coverage for the approved oracle', async () => {
    const pool = mockPool([
      {
        scenarios: [
          { id: 's1', title: 'ok', given: ['g'], when: 'w', thenSteps: ['t'], status: 'human_approved' },
          { id: 's2', title: 'drafted', given: [], when: '', thenSteps: [], status: 'drafted' },
        ],
        coverage: { 'AC-1': ['s1'] },
      },
    ])
    const repo = new OracleRepo(pool)
    const result = await repo.approvedOracleForStory('wf-1', 'story-1')
    expect(result).not.toBeNull()
    expect(result!.scenarios.map((s) => s.id)).toEqual(['s1'])
    expect(result!.coverage).toEqual({ 'AC-1': ['s1'] })
  })

  it('returns null when no approved oracle row', async () => {
    const repo = new OracleRepo(mockPool([]))
    expect(await repo.approvedOracleForStory('wf-1', 'story-1')).toBeNull()
  })

  it('returns null when approved oracle has zero human_approved scenarios', async () => {
    const repo = new OracleRepo(mockPool([{ scenarios: [{ id: 's1', status: 'drafted' }], coverage: {} }]))
    expect(await repo.approvedOracleForStory('wf-1', 'story-1')).toBeNull()
  })

  it('queries status=approved + story_id, highest version first', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = new OracleRepo({ query } as unknown as Pool)
    await repo.approvedOracleForStory('wf-9', 'story-9')
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(sql).toMatch(/ORDER BY version DESC/)
    expect(params).toEqual(['wf-9', 'story-9', 'approved'])
  })
})
