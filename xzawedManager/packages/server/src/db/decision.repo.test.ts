import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { DecisionRepo } from './decision.repo.js'

/**
 * 단일 tx 경로(createRequest·recordDecision·recordSignOff·expire·supersede)는 client(connect)로,
 * 조회(getRequest·pendingByWorkflow·decisionsForRequest)는 pool.query로 — 같은 vi.fn을 공유해 전 호출을 검사한다.
 */
function makeMockPool(opts: {
  requestRows?: unknown[]        // SELECT ... FROM decision_requests ... FOR UPDATE
  decisionJoinRows?: unknown[]   // SELECT ... FROM human_decisions JOIN ... FOR UPDATE
  requestInsertCount?: number    // INSERT INTO decision_requests ON CONFLICT
  decisionInsertCount?: number   // INSERT INTO human_decisions ON CONFLICT
  signoffInsertCount?: number    // INSERT INTO sign_offs ON CONFLICT
  selectRows?: unknown[]         // 비-tx 조회 결과
} = {}) {
  const pendingRow = { workflow_id: 'wf1', correlation_id: 'wf1', status: 'PENDING' }
  const joinRow = { workflow_id: 'wf1', correlation_id: 'wf1' }
  const query = vi.fn().mockImplementation((sql: string) => {
    if (/FROM human_decisions[\s\S]*JOIN[\s\S]*FOR UPDATE/i.test(sql)) {
      return Promise.resolve({ rows: opts.decisionJoinRows ?? [joinRow] })
    }
    if (/SELECT[\s\S]* FROM decision_requests[\s\S]*FOR UPDATE/i.test(sql)) {
      return Promise.resolve({ rows: opts.requestRows ?? [pendingRow] })
    }
    if (/INSERT INTO decision_requests/i.test(sql)) return Promise.resolve({ rows: [], rowCount: opts.requestInsertCount ?? 1 })
    if (/INSERT INTO human_decisions/i.test(sql)) return Promise.resolve({ rows: [], rowCount: opts.decisionInsertCount ?? 1 })
    if (/INSERT INTO sign_offs/i.test(sql)) return Promise.resolve({ rows: [], rowCount: opts.signoffInsertCount ?? 1 })
    if (/SELECT .* FROM decision_requests/i.test(sql)) return Promise.resolve({ rows: opts.selectRows ?? [] })
    if (/SELECT .* FROM human_decisions/i.test(sql)) return Promise.resolve({ rows: opts.selectRows ?? [] })
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn().mockResolvedValue(client)
  return { pool: { connect, query } as unknown as Pool, query, release, connect }
}
const callFor = (q: ReturnType<typeof vi.fn>, re: RegExp) => q.mock.calls.find((c) => re.test(String(c[0])))
const verbs = (q: ReturnType<typeof vi.fn>) => q.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase())

const REQ = { requestId: 'req-1', type: 'defect_brief' as const, workflowId: 'wf1', correlationId: 'wf1' }

describe('DecisionRepo.createRequest', () => {
  it('단일 tx로 INSERT decision_requests + events(decision.requested) + outbox(manager:decision:main)→COMMIT, {eventId} 반환', async () => {
    const m = makeMockPool()
    const res = await new DecisionRepo(m.pool, () => 1000).createRequest(REQ)
    const v = verbs(m.query)
    expect(v[0]).toBe('BEGIN')
    expect(v[v.length - 1]).toBe('COMMIT')
    expect(callFor(m.query, /INSERT INTO decision_requests/i)).toBeTruthy()
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('decision.requested')         // event_type
    expect(ev[6]).toBe('wf1:decision.requested:req-1:0') // idempotency_key
    const ob = callFor(m.query, /INSERT INTO manager_outbox/i)![1] as unknown[]
    expect(ob[1]).toBe('manager:decision:main')       // stream
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('멱등: ON CONFLICT DO NOTHING(rowCount 0)이면 ROLLBACK·null·이벤트 미적재', async () => {
    const m = makeMockPool({ requestInsertCount: 0 })
    const res = await new DecisionRepo(m.pool, () => 1).createRequest(REQ)
    expect(res).toBeNull()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
    expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
    expect(m.release).toHaveBeenCalled()
  })
})

describe('DecisionRepo.recordDecision', () => {
  const DEC = { decisionId: 'd1', requestId: 'req-1', decidedBy: 'human-1', choice: 'approve' as const }

  it('PENDING 요청 → human_decisions INSERT + status RESOLVED + events(decision.recorded·actor=decidedBy·causation=requestId) + outbox', async () => {
    const m = makeMockPool()
    const res = await new DecisionRepo(m.pool, () => 1000).recordDecision(DEC)
    expect(callFor(m.query, /INSERT INTO human_decisions/i)).toBeTruthy()
    const upd = callFor(m.query, /UPDATE decision_requests/i)![1] as unknown[]
    expect(upd).toContain('RESOLVED')
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('decision.recorded')
    expect(ev[5]).toBe('req-1')      // causation_id = request_id (§3)
    expect(ev[7]).toBe('human-1')    // actor = decided_by (부인방지 M9)
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('비-PENDING 요청 → null·human_decisions 미적재·이벤트 미적재(상태머신 §2)', async () => {
    const m = makeMockPool({ requestRows: [{ workflow_id: 'wf1', correlation_id: 'wf1', status: 'RESOLVED' }] })
    expect(await new DecisionRepo(m.pool, () => 1).recordDecision(DEC)).toBeNull()
    expect(callFor(m.query, /INSERT INTO human_decisions/i)).toBeUndefined()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
    expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
  })

  it('미존재 요청 → null', async () => {
    const m = makeMockPool({ requestRows: [] })
    expect(await new DecisionRepo(m.pool, () => 1).recordDecision(DEC)).toBeNull()
    expect(callFor(m.query, /INSERT INTO human_decisions/i)).toBeUndefined()
  })

  it('중복 decision_id(human_decisions rowCount 0) → null·이벤트 미적재(M6 no-op)', async () => {
    const m = makeMockPool({ decisionInsertCount: 0 })
    expect(await new DecisionRepo(m.pool, () => 1).recordDecision(DEC)).toBeNull()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
    expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
  })
})

describe('DecisionRepo.recordSignOff', () => {
  const SO = { signoffId: 'so1', decisionId: 'd1', scope: 'release X', approver: 'human-1' }

  it('존재하는 결정 → sign_offs INSERT + events(signoff.recorded·actor=approver) + outbox→COMMIT', async () => {
    const m = makeMockPool()
    const res = await new DecisionRepo(m.pool, () => 1000).recordSignOff(SO)
    expect(callFor(m.query, /INSERT INTO sign_offs/i)).toBeTruthy()
    const ev = callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[]
    expect(ev[2]).toBe('signoff.recorded')
    expect(ev[7]).toBe('human-1')   // actor = approver
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('미존재 결정 → null·sign_offs 미적재', async () => {
    const m = makeMockPool({ decisionJoinRows: [] })
    expect(await new DecisionRepo(m.pool, () => 1).recordSignOff(SO)).toBeNull()
    expect(callFor(m.query, /INSERT INTO sign_offs/i)).toBeUndefined()
    expect(callFor(m.query, /ROLLBACK/i)).toBeTruthy()
  })

  it('중복 signoff_id(rowCount 0) → null·이벤트 미적재(M6)', async () => {
    const m = makeMockPool({ signoffInsertCount: 0 })
    expect(await new DecisionRepo(m.pool, () => 1).recordSignOff(SO)).toBeNull()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
  })
})

describe('DecisionRepo.expireRequest / supersedeRequest (M8 — 무음 통과 금지)', () => {
  it('PENDING → status EXPIRED + events(decision.expired)→COMMIT', async () => {
    const m = makeMockPool()
    const res = await new DecisionRepo(m.pool, () => 1000).expireRequest('req-1')
    const upd = callFor(m.query, /UPDATE decision_requests/i)![1] as unknown[]
    expect(upd).toContain('EXPIRED')
    expect((callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[])[2]).toBe('decision.expired')
    expect(res).toEqual({ eventId: expect.stringMatching(/[0-9a-f-]{36}/) })
  })

  it('비-PENDING expire → null·이벤트 미적재', async () => {
    const m = makeMockPool({ requestRows: [{ workflow_id: 'wf1', correlation_id: 'wf1', status: 'RESOLVED' }] })
    expect(await new DecisionRepo(m.pool, () => 1).expireRequest('req-1')).toBeNull()
    expect(callFor(m.query, /INSERT INTO manager_events/i)).toBeUndefined()
  })

  it('PENDING → status SUPERSEDED + events(decision.superseded)', async () => {
    const m = makeMockPool()
    await new DecisionRepo(m.pool, () => 1000).supersedeRequest('req-1')
    const upd = callFor(m.query, /UPDATE decision_requests/i)![1] as unknown[]
    expect(upd).toContain('SUPERSEDED')
    expect((callFor(m.query, /INSERT INTO manager_events/i)![1] as unknown[])[2]).toBe('decision.superseded')
  })
})

describe('DecisionRepo project scope (C0/C1)', () => {
  it('createRequest INSERT 파라미터에 project_id 포함', async () => {
    const m = makeMockPool()
    await new DecisionRepo(m.pool, () => 1000).createRequest({ ...REQ, projectId: 'proj-1' })
    const ins = callFor(m.query, /INSERT INTO decision_requests/i)![1] as unknown[]
    expect(ins).toContain('proj-1')
  })

  it('pendingByProject: project_id=$1 AND status=PENDING 필터', async () => {
    const row = { request_id: 'r1', type: 'defect_brief', workflow_id: 'wf', wp_id: null, correlation_id: 'wf', context: {}, severity: 'blocking', status: 'PENDING', language: 'ko', expires_at: null, project_id: 'proj-1' }
    const m = makeMockPool({ selectRows: [row] })
    const res = await new DecisionRepo(m.pool, () => 1000).pendingByProject('proj-1')
    expect(callFor(m.query, /WHERE project_id = \$1 AND status/i)).toBeTruthy()
    expect(callFor(m.query, /ORDER BY created_at/i)).toBeTruthy()
    expect(res[0]?.projectId).toBe('proj-1')
  })
})

describe('DecisionRepo queries', () => {
  const dbRow = {
    request_id: 'req-1', type: 'defect_brief', workflow_id: 'wf1', wp_id: null, correlation_id: 'wf1',
    context: { impact: [], evidenceRefs: [], options: [] }, severity: 'blocking', status: 'PENDING',
    language: 'ko', expires_at: null, project_id: null,
  }

  it('getRequest: snake_case 행을 DecisionRequest로 매핑·parse(미존재→null)', async () => {
    const m = makeMockPool({ selectRows: [dbRow] })
    const r = await new DecisionRepo(m.pool).getRequest('req-1')
    expect(r?.requestId).toBe('req-1')
    expect(r?.status).toBe('PENDING')
    const empty = makeMockPool({ selectRows: [] })
    expect(await new DecisionRepo(empty.pool).getRequest('nope')).toBeNull()
  })

  it('pendingByWorkflow: WHERE workflow_id=$1 AND status=$2(PENDING)로 조회', async () => {
    const m = makeMockPool({ selectRows: [dbRow] })
    const rows = await new DecisionRepo(m.pool).pendingByWorkflow('wf1')
    expect(rows).toHaveLength(1)
    const [sql, params] = m.query.mock.calls[0]!
    expect(String(sql)).toMatch(/WHERE workflow_id = \$1 AND status = \$2/i)
    expect(params).toEqual(['wf1', 'PENDING'])
  })

  it('decisionsForRequest: WHERE request_id=$1로 결정 목록 매핑', async () => {
    const m = makeMockPool({ selectRows: [{ decision_id: 'd1', request_id: 'req-1', decided_by: 'h', authority: null, choice: 'approve', justification: null, routed_to: null }] })
    const rows = await new DecisionRepo(m.pool).decisionsForRequest('req-1')
    expect(rows[0]?.decisionId).toBe('d1')
    expect(rows[0]?.choice).toBe('approve')
    const [sql, params] = m.query.mock.calls[0]!
    expect(String(sql)).toMatch(/WHERE request_id = \$1/i)
    expect(params).toEqual(['req-1'])
  })
})
