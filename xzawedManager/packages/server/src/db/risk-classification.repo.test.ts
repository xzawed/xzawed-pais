import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { RiskClassificationRepo } from './risk-classification.repo.js'

/** shared RiskClassificationSchema를 통과하는 최소 유효 아티팩트(approve SELECT가 재검증). */
function makeArtifact(over: Record<string, unknown> = {}) {
  return {
    projectId: 'p1', risk: 'HIGH',
    dimensionScores: {
      domain: { score: 0.8, confidence: 0.9 }, complexity: { score: 0, confidence: 0 },
      external_deps: { score: 0, confidence: 0 }, compliance: { score: 0, confidence: 0 },
    },
    complianceFrameworks: [], claims: [],
    modelRouting: { PM: 'opus', Developer: 'opus', Designer: 'opus', Tester: 'opus', Security: 'opus' },
    humanGate: { required: true, reason: 'HIGH risk' },
    classifierModel: 'opus',
    audit: { approvedBy: null, approvedAt: null, version: 1 },
    ...over,
  }
}

function makeMockPool(opts: { forUpdateRows?: unknown[]; selectRows?: unknown[] } = {}) {
  const pendingRow = { project_id: 'p1', version: 1, status: 'pending', artifact: makeArtifact() }
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/SELECT .* FROM risk_classifications .* FOR UPDATE/i.test(sql)) {
      return Promise.resolve({ rows: opts.forUpdateRows ?? [pendingRow] })
    }
    if (/INSERT INTO risk_classifications/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 1 })
    if (/SELECT .* FROM risk_classifications/i.test(sql)) return Promise.resolve({ rows: opts.selectRows ?? [] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect, query } as unknown as Pool, query, release, connect }
}
const callFor = (q: ReturnType<typeof vi.fn>, re: RegExp) => q.mock.calls.find((c) => re.test(String(c[0])))
const verbs = (q: ReturnType<typeof vi.fn>) => q.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())

describe('RiskClassificationRepo.upsert', () => {
  it('INSERT ... ON CONFLICT (workflow_id) DO UPDATE version++·status=pending·승인 클리어(재채점=재승인 N6)', async () => {
    const m = makeMockPool()
    await new RiskClassificationRepo(m.pool).upsert({ workflowId: 'wf1', classification: makeArtifact() as never })
    const sql = String(m.query.mock.calls[0]![0])
    const args = m.query.mock.calls[0]![1] as unknown[]
    expect(sql).toMatch(/INSERT INTO risk_classifications/i)
    expect(sql).toMatch(/ON CONFLICT \(workflow_id\) DO UPDATE/i)
    expect(sql).toMatch(/version\s*=\s*risk_classifications\.version\s*\+\s*1/i)
    expect(sql).toMatch(/status\s*=\s*'pending'/i)
    expect(sql).toMatch(/approved_at\s*=\s*NULL/i)   // 재채점 시 이전 승인 무효
    expect(args[0]).toBe('wf1')
    expect(args[1]).toBe('p1')            // project_id (아티팩트에서)
    expect(args[2]).toBe('HIGH')          // risk (denormalized)
    expect(JSON.parse(args[3] as string).risk).toBe('HIGH') // artifact JSONB
  })
})

describe('RiskClassificationRepo.approve (N6 — 승인된 분류만 라우팅 확정)', () => {
  it('단일 tx로 SELECT FOR UPDATE + UPDATE(approved·audit) + events(risk.approved) + outbox(manager:risk:main)→COMMIT', async () => {
    const m = makeMockPool()
    const res = await new RiskClassificationRepo(m.pool, () => 1000).approve('wf1', 'human-1')
    const v = verbs(m.query)
    expect(v[0]).toBe('BEGIN')
    expect(v[v.length - 1]).toBe('COMMIT')
    expect(callFor(m.query, /SELECT .* FROM risk_classifications .* FOR UPDATE/i)).toBeTruthy()
    const upd = callFor(m.query, /UPDATE risk_classifications/i)![1] as unknown[]
    expect(upd).toContain('approved')          // status
    expect(upd).toContain('human-1')           // approved_by
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('risk.approved')        // event_type
    expect(ev[7]).toBe('human-1')              // actor = approver (M9)
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[1]).toBe('manager:risk:main')    // stream
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('아티팩트 audit.approvedBy/At를 승인자·시각으로 갱신(UPDATE artifact 바인딩)', async () => {
    const m = makeMockPool()
    await new RiskClassificationRepo(m.pool, () => 1000).approve('wf1', 'human-1')
    const upd = callFor(m.query, /UPDATE risk_classifications/i)![1] as unknown[]
    const artifactArg = upd.find((a) => typeof a === 'string' && a.includes('"audit"')) as string
    const audit = JSON.parse(artifactArg).audit
    expect(audit.approvedBy).toBe('human-1')
    expect(audit.approvedAt).not.toBeNull()
  })

  it('멱등키 {wf}:risk.approved:{wf}:{version}(version=SELECT row)', async () => {
    const m = makeMockPool({ forUpdateRows: [{ project_id: 'p1', version: 4, status: 'pending', artifact: makeArtifact() }] })
    await new RiskClassificationRepo(m.pool, () => 1000).approve('wf1', 'h')
    expect((callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[])[6]).toBe('wf1:risk.approved:wf1:4')
  })

  it('status≠pending(approved·superseded·미존재) → null·이벤트 미적재', async () => {
    for (const rows of [[], [{ project_id: 'p1', version: 1, status: 'approved', artifact: makeArtifact() }], [{ project_id: 'p1', version: 1, status: 'superseded', artifact: makeArtifact() }]]) {
      const m = makeMockPool({ forUpdateRows: rows })
      expect(await new RiskClassificationRepo(m.pool, () => 1).approve('wf1', 'h')).toBeNull()
      expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
      expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
    }
  })

  it('불량 artifact JSON이면 parse throw→ROLLBACK·UPDATE/events/outbox 미적재·client release', async () => {
    const m = makeMockPool({ forUpdateRows: [{ project_id: 'p1', version: 1, status: 'pending', artifact: { risk: 'NOPE' } }] })
    await expect(new RiskClassificationRepo(m.pool, () => 1000).approve('wf1', 'h')).rejects.toThrow()
    expect(callFor(m.query, /UPDATE risk_classifications/i)).toBeUndefined()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
    expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
    expect(m.release).toHaveBeenCalled()
  })
})

describe('RiskClassificationRepo queries', () => {
  it('getByWorkflow: artifact를 RiskClassification으로 parse + status/version 반환(미존재→null)', async () => {
    const m = makeMockPool({ selectRows: [{ workflow_id: 'wf1', project_id: 'p1', version: 2, status: 'approved', risk: 'HIGH', artifact: makeArtifact() }] })
    const r = await new RiskClassificationRepo(m.pool).getByWorkflow('wf1')
    expect(r?.status).toBe('approved')
    expect(r?.version).toBe(2)
    expect(r?.classification.risk).toBe('HIGH')
    const empty = makeMockPool({ selectRows: [] })
    expect(await new RiskClassificationRepo(empty.pool).getByWorkflow('nope')).toBeNull()
  })

  it('approvedForWorkflow: status=approved 행의 분류만 반환(WHERE status=$2 approved)·미승인→null', async () => {
    const m = makeMockPool({ selectRows: [{ artifact: makeArtifact({ risk: 'MEDIUM' }) }] })
    const r = await new RiskClassificationRepo(m.pool).approvedForWorkflow('wf1')
    expect(r?.risk).toBe('MEDIUM')
    expect(r?.modelRouting.PM).toBe('opus')
    const [sql, params] = m.query.mock.calls[0]!
    expect(String(sql)).toMatch(/status = \$2/i)
    expect(params).toEqual(['wf1', 'approved'])

    const none = makeMockPool({ selectRows: [] })
    expect(await new RiskClassificationRepo(none.pool).approvedForWorkflow('wf1')).toBeNull()
  })
})
