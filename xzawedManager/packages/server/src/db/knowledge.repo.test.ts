import { describe, it, expect, vi } from 'vitest'
import { KnowledgeRepo, type KnowledgeEntry } from './knowledge.repo.js'

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as
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
    const pool = mockPool([{ content: '결제는 Stripe', source_agent: 'planner', created_at: 't' }])
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

  it('recentByProject는 created_at DESC LIMIT로 조회해 createdAt 포함 매핑한다', async () => {
    const pool = mockPool([
      { content: 'a', source_agent: 'planner', created_at: '2026-06-02T00:00:00Z' },
      { content: 'b', source_agent: 'developer', created_at: '2026-06-01T00:00:00Z' },
    ])
    const out = await new KnowledgeRepo(pool).recentByProject('p1', 20)
    expect(pool.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/i)
    expect(pool.query.mock.calls[0][1]).toEqual(['p1', 20])
    expect(out).toEqual([
      { content: 'a', sourceAgent: 'planner', createdAt: '2026-06-02T00:00:00Z' },
      { content: 'b', sourceAgent: 'developer', createdAt: '2026-06-01T00:00:00Z' },
    ])
  })

  it('recentByProject는 category가 있으면 매핑하고 없으면 생략한다', async () => {
    const pool = mockPool([
      { content: 'a', source_agent: 'planner', category: 'decision', created_at: 't' },
      { content: 'b', source_agent: 'planner', category: null, created_at: 't' },
    ])
    const out = await new KnowledgeRepo(pool).recentByProject('p1', 20)
    expect(pool.query.mock.calls[0][0]).toMatch(/SELECT content, source_agent, category/i)
    expect(out[0]).toEqual({ content: 'a', sourceAgent: 'planner', category: 'decision', createdAt: 't' })
    expect(out[1]).toEqual({ content: 'b', sourceAgent: 'planner', createdAt: 't' })
  })
})
