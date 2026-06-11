import { describe, it, expect } from 'vitest'
import { createPool, runMigrations, closePool } from '../src/db/pool.js'
import { DecisionRepo } from '../src/db/decision.repo.js'
import { handleLeaseSweep, type SweepDeps } from '../src/streams/lease.js'
import { makeEscalationBrief } from '../src/streams/decision-brief.js'

// CI(turborepo 잡)는 TEST_DATABASE_URL을 주입 — 게이트 통일(oracle-loop·event-sourcing 통합 패턴).
const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']

// M9 영속 루프를 실 Postgres로 실증: 요청 생성→사람 결정→사인오프→조회, 멱등·상태머신·append-only.
// DB URL 없으면 skip. prefix 'wf-dec-' 스코프 정리(형제 통합 테스트 병렬 간섭 방지).
describe.skipIf(!url)('M9 결정 영속 통합(요청→결정→사인오프)', () => {
  async function cleanup(pool: ReturnType<typeof createPool>): Promise<void> {
    await pool.query("DELETE FROM manager_outbox WHERE message::text LIKE '%wf-dec-%'").catch(() => undefined)
    await pool.query("DELETE FROM manager_events WHERE session_id LIKE 'wf-dec-%'").catch(() => undefined)
    await pool.query(
      `DELETE FROM sign_offs WHERE decision_id IN (
         SELECT hd.decision_id FROM human_decisions hd JOIN decision_requests dr ON hd.request_id = dr.request_id
         WHERE dr.workflow_id LIKE 'wf-dec-%')`,
    ).catch(() => undefined)
    await pool.query("DELETE FROM human_decisions WHERE request_id IN (SELECT request_id FROM decision_requests WHERE workflow_id LIKE 'wf-dec-%')").catch(() => undefined)
    await pool.query("DELETE FROM decision_requests WHERE workflow_id LIKE 'wf-dec-%'").catch(() => undefined)
  }

  it('createRequest(PENDING) → recordDecision(RESOLVED) → recordSignOff, 이벤트 3건 적재', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new DecisionRepo(pool)
      const wf = `wf-dec-${Date.now()}`
      const requestId = `${wf}-req1`

      // 1) 결함 브리프 요청 생성(PENDING).
      const created = await repo.createRequest({
        requestId, type: 'defect_brief', workflowId: wf, correlationId: wf,
        wpId: 'wp-1', context: { location: 'wp-1', impact: ['s1'], options: ['fix_reverify', 'reject'] },
      })
      expect(created).not.toBeNull()
      const pending = await repo.getRequest(requestId)
      expect(pending?.status).toBe('PENDING')
      expect(pending?.context.impact).toEqual(['s1'])
      expect((await repo.pendingByWorkflow(wf)).map((r) => r.requestId)).toContain(requestId)

      // 2) 사람 결정 기록 → RESOLVED 전이.
      const decisionId = `${wf}-dec1`
      const decided = await repo.recordDecision({
        decisionId, requestId, decidedBy: 'human-1', authority: 'PO', choice: 'fix_reverify', routedTo: 'impl', justification: '재구현 필요',
      })
      expect(decided).not.toBeNull()
      expect((await repo.getRequest(requestId))?.status).toBe('RESOLVED')
      expect(await repo.pendingByWorkflow(wf)).toHaveLength(0)
      const decisions = await repo.decisionsForRequest(requestId)
      expect(decisions).toHaveLength(1)
      expect(decisions[0]?.choice).toBe('fix_reverify')
      expect(decisions[0]?.routedTo).toBe('impl')

      // 3) 사인오프(위험 수용) 기록.
      const signedOff = await repo.recordSignOff({
        signoffId: `${wf}-so1`, decisionId, scope: 'release X', risk: 'HIGH', reason: '기한 압박', approver: 'lead-1', authorityLevel: 'L3', techDebtRef: 'TD-9',
      })
      expect(signedOff).not.toBeNull()

      // 이벤트 로그: decision.requested + decision.recorded + signoff.recorded (M4/M7/M9).
      const { rows } = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM manager_events WHERE session_id = $1 ORDER BY seq", [wf],
      )
      expect(rows.map((r) => r.event_type)).toEqual(['decision.requested', 'decision.recorded', 'signoff.recorded'])
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('멱등·상태머신: 중복 request/decision은 no-op, 비-PENDING 결정·만료는 거부', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new DecisionRepo(pool)
      const wf = `wf-dec-sm-${Date.now()}`
      const requestId = `${wf}-req1`

      await repo.createRequest({ requestId, type: 'gate_override', workflowId: wf, correlationId: wf })
      // 동일 request_id 재생 → no-op(null·중복 이벤트 미적재, M6).
      expect(await repo.createRequest({ requestId, type: 'gate_override', workflowId: wf, correlationId: wf })).toBeNull()

      const decisionId = `${wf}-dec1`
      expect(await repo.recordDecision({ decisionId, requestId, decidedBy: 'h', choice: 'approve' })).not.toBeNull()
      // 동일 decision_id 재생 → no-op(이미 RESOLVED·M6).
      expect(await repo.recordDecision({ decisionId, requestId, decidedBy: 'h', choice: 'approve' })).toBeNull()
      // 이미 RESOLVED 요청에 새 결정 → null(상태머신 §2).
      expect(await repo.recordDecision({ decisionId: `${wf}-dec2`, requestId, decidedBy: 'h', choice: 'reject' })).toBeNull()

      // expire는 PENDING만 — 이미 RESOLVED면 null.
      expect(await repo.expireRequest(requestId)).toBeNull()

      // 별도 PENDING 요청 → expire → EXPIRED 전이, 이후 결정 거부.
      const req2 = `${wf}-req2`
      await repo.createRequest({ requestId: req2, type: 'safe_resume', workflowId: wf, correlationId: wf })
      expect(await repo.expireRequest(req2)).not.toBeNull()
      expect((await repo.getRequest(req2))?.status).toBe('EXPIRED')
      expect(await repo.recordDecision({ decisionId: `${wf}-dec3`, requestId: req2, decidedBy: 'h', choice: 'resume' })).toBeNull()

      // 단 한 건의 사람 결정만 기록(중복·거부된 시도는 미적재 — append-only 무결성).
      expect(await repo.decisionsForRequest(requestId)).toHaveLength(1)
    } finally {
      await cleanup(pool)
      await closePool()
    }
  })

  it('P6: handleLeaseSweep escalation → makeEscalationBrief → defect_brief DecisionRequest 영속', async () => {
    const pool = createPool(url!)
    try {
      await runMigrations(pool)
      const repo = new DecisionRepo(pool)
      const wf = `wf-dec-brief-${Date.now()}`
      // mock LeaseStore: 만료 lease 1건이 상한 초과로 escalate(attempt 2·maxAttempts 3).
      const store = {
        expiredActiveLeases: async () => [
          { workflowId: wf, wpId: 'wp_x', attempt: 2, owner: null, status: 'active', expiresAt: 0, stepN: 1, eventId: null },
        ],
        recordReclaim: async () => ({ status: 'skipped' as const }),
        recordEscalation: async () => ({ status: 'escalated' as const, eventId: 'ev', seq: 1 }),
      }
      // onEscalated를 실 DecisionRepo로 배선(createSupervisor가 production에서 하는 것과 동일).
      const deps = { store, maxAttempts: 3, onEscalated: makeEscalationBrief(repo) } as unknown as SweepDeps
      await handleLeaseSweep(1000, deps)

      const req = await repo.getRequest(`${wf}:wp_x:2`)
      expect(req?.type).toBe('defect_brief')
      expect(req?.status).toBe('PENDING')
      expect(req?.wpId).toBe('wp_x')
      expect(req?.context.options).toContain('fix_reverify')
    } finally {
      await cleanup(pool) // wf-dec-% prefix가 wf-dec-brief-% 포함
      await closePool()
    }
  })
})
