import { describe, it, expect, vi } from 'vitest'
import { KnowledgeRepo, type KnowledgeEntry } from './knowledge.repo.js'

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as
    import('pg').Pool & { query: ReturnType<typeof vi.fn> }
}

/** rowCount만 반환하는 변이(UPDATE/DELETE)용 mock pool. */
function mockMutationPool(rowCount: number) {
  return { query: vi.fn().mockResolvedValue({ rowCount }) } as unknown as
    import('pg').Pool & { query: ReturnType<typeof vi.fn> }
}

describe('KnowledgeRepo', () => {
  it('insertMany는 빈 배열이면 쿼리하지 않는다', async () => {
    const pool = mockPool()
    await new KnowledgeRepo(pool).insertMany('p1', [])
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('insertMany는 각 항목을 project_id·content·source_agent·category로 INSERT한다', async () => {
    const pool = mockPool()
    const entries: KnowledgeEntry[] = [
      { content: '결제는 Stripe 사용', sourceAgent: 'planner', category: 'decision' },
      { content: 'PII는 암호화', sourceAgent: 'planner' },
    ]
    await new KnowledgeRepo(pool).insertMany('p1', entries)
    expect(pool.query).toHaveBeenCalledTimes(2)
    expect(pool.query.mock.calls[0][1]).toEqual(['p1', '결제는 Stripe 사용', 'planner', 'decision'])
    // category 없으면 null로 저장
    expect(pool.query.mock.calls[1][1]).toEqual(['p1', 'PII는 암호화', 'planner', null])
  })

  it('recentByProject에 query가 있으면 content ILIKE 필터를 추가한다', async () => {
    const pool = mockPool([{ id: 7, content: '결제는 Stripe', source_agent: 'planner', created_at: 't' }])
    const out = await new KnowledgeRepo(pool).recentByProject('p1', 20, 'stripe')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/content ILIKE/i)
    expect(params).toEqual(['p1', 'stripe', 20])
    expect(out).toHaveLength(1)
  })

  it('recentByProject에 query가 없으면 필터 없이 projectId·limit만 바인딩한다', async () => {
    const pool = mockPool([])
    await new KnowledgeRepo(pool).recentByProject('p1', 20)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).not.toMatch(/ILIKE/i)
    expect(params).toEqual(['p1', 20])
  })

  it('recentByProject에 sourceAgent가 있으면 source_agent 필터를 추가한다', async () => {
    const pool = mockPool([])
    await new KnowledgeRepo(pool).recentByProject('p1', 20, undefined, 'security_audit')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/source_agent = /i)
    expect(params).toEqual(['p1', 'security_audit', 20])
  })

  it('recentByProject는 query·sourceAgent를 함께 필터한다', async () => {
    const pool = mockPool([])
    await new KnowledgeRepo(pool).recentByProject('p1', 20, 'jwt', 'develop_code')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/content ILIKE/i)
    expect(sql).toMatch(/source_agent = /i)
    expect(params).toEqual(['p1', 'jwt', 'develop_code', 20])
  })

  it('recentByProject에 category가 있으면 category 필터를 추가한다', async () => {
    const pool = mockPool([])
    await new KnowledgeRepo(pool).recentByProject('p1', 20, undefined, undefined, 'decision')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/category = /i)
    expect(params).toEqual(['p1', 'decision', 20])
  })

  it('recentByProject는 query·sourceAgent·category를 함께 필터한다', async () => {
    const pool = mockPool([])
    await new KnowledgeRepo(pool).recentByProject('p1', 20, 'jwt', 'develop_code', 'constraint')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/content ILIKE/i)
    expect(sql).toMatch(/source_agent = /i)
    expect(sql).toMatch(/category = /i)
    expect(params).toEqual(['p1', 'jwt', 'develop_code', 'constraint', 20])
  })

  it('recentByProject는 created_at DESC LIMIT로 조회해 id·createdAt 포함 매핑한다', async () => {
    const pool = mockPool([
      { id: 10, content: 'a', source_agent: 'planner', created_at: '2026-06-02T00:00:00Z' },
      { id: 9, content: 'b', source_agent: 'developer', created_at: '2026-06-01T00:00:00Z' },
    ])
    const out = await new KnowledgeRepo(pool).recentByProject('p1', 20)
    expect(pool.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/i)
    expect(pool.query.mock.calls[0][1]).toEqual(['p1', 20])
    expect(out).toEqual([
      { id: 10, content: 'a', sourceAgent: 'planner', createdAt: '2026-06-02T00:00:00Z' },
      { id: 9, content: 'b', sourceAgent: 'developer', createdAt: '2026-06-01T00:00:00Z' },
    ])
  })

  it('recentByProject는 SELECT에 id를 포함하고 id를 number로 매핑한다(BIGINT 문자열 허용)', async () => {
    const pool = mockPool([{ id: '42', content: 'a', source_agent: 'planner', created_at: 't' }])
    const out = await new KnowledgeRepo(pool).recentByProject('p1', 20)
    expect(pool.query.mock.calls[0][0]).toMatch(/SELECT id, content, source_agent, category/i)
    expect(out[0]?.id).toBe(42)
    expect(typeof out[0]?.id).toBe('number')
  })

  it('recentByProject는 category가 있으면 매핑하고 없으면 생략한다', async () => {
    const pool = mockPool([
      { id: 2, content: 'a', source_agent: 'planner', category: 'decision', created_at: 't' },
      { id: 1, content: 'b', source_agent: 'planner', category: null, created_at: 't' },
    ])
    const out = await new KnowledgeRepo(pool).recentByProject('p1', 20)
    expect(pool.query.mock.calls[0][0]).toMatch(/SELECT id, content, source_agent, category/i)
    expect(out[0]).toEqual({ id: 2, content: 'a', sourceAgent: 'planner', category: 'decision', createdAt: 't' })
    expect(out[1]).toEqual({ id: 1, content: 'b', sourceAgent: 'planner', createdAt: 't' })
  })

  describe('updateById', () => {
    it('content·category를 UPDATE하고 WHERE에 id AND project_id 가드를 둔다', async () => {
      const pool = mockMutationPool(1)
      const ok = await new KnowledgeRepo(pool).updateById('p1', 5, '수정된 내용', 'rule')
      const [sql, params] = pool.query.mock.calls[0]
      expect(sql).toMatch(/UPDATE domain_knowledge SET content = \$1, category = \$2/i)
      expect(sql).toMatch(/WHERE id = \$3 AND project_id = \$4/i)
      expect(params).toEqual(['수정된 내용', 'rule', 5, 'p1'])
      expect(ok).toBe(true)
    })

    it('category=null이면 분류 해제 값으로 바인딩한다', async () => {
      const pool = mockMutationPool(1)
      await new KnowledgeRepo(pool).updateById('p1', 5, '내용', null)
      expect(pool.query.mock.calls[0][1]).toEqual(['내용', null, 5, 'p1'])
    })

    it('rowCount가 0이면 false를 반환한다(타 프로젝트·없는 id)', async () => {
      const pool = mockMutationPool(0)
      const ok = await new KnowledgeRepo(pool).updateById('p1', 999, '내용', null)
      expect(ok).toBe(false)
    })

    it('rowCount가 undefined여도 false로 처리한다', async () => {
      const pool = { query: vi.fn().mockResolvedValue({ rowCount: undefined }) } as unknown as
        import('pg').Pool & { query: ReturnType<typeof vi.fn> }
      const ok = await new KnowledgeRepo(pool).updateById('p1', 5, '내용', null)
      expect(ok).toBe(false)
    })
  })

  it('recentByProject는 soft-delete된 행을 제외한다(deleted_at IS NULL)', async () => {
    const pool = mockPool([])
    await new KnowledgeRepo(pool).recentByProject('p1', 20)
    expect(pool.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/i)
  })

  describe('deleteById (soft-delete)', () => {
    it('deleted_at을 NOW()로 설정하고 id AND project_id 가드를 둔다(하드 삭제 아님)', async () => {
      const pool = mockMutationPool(1)
      const ok = await new KnowledgeRepo(pool).deleteById('p1', 5)
      const [sql, params] = pool.query.mock.calls[0]
      expect(sql).toMatch(/UPDATE domain_knowledge SET deleted_at = NOW\(\)/i)
      expect(sql).toMatch(/WHERE id = \$1 AND project_id = \$2/i)
      expect(sql).toMatch(/deleted_at IS NULL/i) // 이미 삭제된 행은 재삭제하지 않음
      expect(sql).not.toMatch(/DELETE FROM/i)
      expect(params).toEqual([5, 'p1'])
      expect(ok).toBe(true)
    })

    it('rowCount가 0이면 false를 반환한다(타 프로젝트·없는 id)', async () => {
      const pool = mockMutationPool(0)
      const ok = await new KnowledgeRepo(pool).deleteById('p1', 999)
      expect(ok).toBe(false)
    })

    it('rowCount가 undefined여도 false로 처리한다', async () => {
      const pool = { query: vi.fn().mockResolvedValue({ rowCount: undefined }) } as unknown as
        import('pg').Pool & { query: ReturnType<typeof vi.fn> }
      const ok = await new KnowledgeRepo(pool).deleteById('p1', 5)
      expect(ok).toBe(false)
    })
  })

  describe('restoreById', () => {
    it('deleted_at을 NULL로 되돌리고 id AND project_id·deleted_at IS NOT NULL 가드를 둔다', async () => {
      const pool = mockMutationPool(1)
      const ok = await new KnowledgeRepo(pool).restoreById('p1', 5)
      const [sql, params] = pool.query.mock.calls[0]
      expect(sql).toMatch(/UPDATE domain_knowledge SET deleted_at = NULL/i)
      expect(sql).toMatch(/WHERE id = \$1 AND project_id = \$2/i)
      expect(sql).toMatch(/deleted_at IS NOT NULL/i) // 삭제된 행만 복구
      expect(params).toEqual([5, 'p1'])
      expect(ok).toBe(true)
    })

    it('rowCount가 0이면 false(없음·타 프로젝트·삭제 안 된 행)', async () => {
      const ok = await new KnowledgeRepo(mockMutationPool(0)).restoreById('p1', 999)
      expect(ok).toBe(false)
    })
  })

  describe('deletedByProject', () => {
    it('soft-delete된 행만 deleted_at DESC로 조회하고 id·createdAt 매핑한다', async () => {
      const pool = mockPool([{ id: 3, content: 'x', source_agent: 'planner', category: null, created_at: 't' }])
      const out = await new KnowledgeRepo(pool).deletedByProject('p1', 20)
      const [sql, params] = pool.query.mock.calls[0]
      expect(sql).toMatch(/deleted_at IS NOT NULL/i)
      expect(sql).toMatch(/ORDER BY deleted_at DESC/i)
      expect(params).toEqual(['p1', 20])
      expect(out).toEqual([{ id: 3, content: 'x', sourceAgent: 'planner', createdAt: 't' }])
    })
  })
})
