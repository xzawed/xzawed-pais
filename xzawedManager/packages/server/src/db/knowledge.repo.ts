import type { Pool } from 'pg'

export interface KnowledgeEntry {
  content: string
  sourceAgent: string
  category?: string
  createdAt?: string
}

/** 프로젝트 단위 도메인 지식(domain_knowledge) 저장소. SessionRepo와 동일 패턴. */
export class KnowledgeRepo {
  constructor(private readonly pool: Pool) {}

  async insertMany(projectId: string, entries: KnowledgeEntry[]): Promise<void> {
    for (const e of entries) {
      await this.pool.query(
        `INSERT INTO domain_knowledge (project_id, content, source_agent, category) VALUES ($1, $2, $3, $4)`,
        [projectId, e.content, e.sourceAgent, e.category ?? null],
      )
    }
  }

  /**
   * 최근순 조회. query가 있으면 content를 대소문자 무관(ILIKE) 부분일치로,
   * sourceAgent가 있으면 산출 에이전트(도구명)로, category가 있으면 의미 분류로 필터한다.
   */
  async recentByProject(
    projectId: string,
    limit: number,
    query?: string,
    sourceAgent?: string,
    category?: string,
  ): Promise<KnowledgeEntry[]> {
    const params: unknown[] = [projectId]
    let where = 'WHERE project_id = $1'
    if (query) {
      params.push(query)
      where += ` AND content ILIKE '%' || $${params.length} || '%'`
    }
    if (sourceAgent) {
      params.push(sourceAgent)
      where += ` AND source_agent = $${params.length}`
    }
    if (category) {
      params.push(category)
      where += ` AND category = $${params.length}`
    }
    params.push(limit)
    const limitIdx = params.length
    const res = await this.pool.query(
      `SELECT content, source_agent, category, created_at FROM domain_knowledge
       ${where} ORDER BY created_at DESC LIMIT $${limitIdx}`,
      params,
    )
    return (res.rows as { content: string; source_agent: string; category: string | null; created_at: unknown }[]).map((r) => ({
      content: r.content,
      sourceAgent: r.source_agent,
      ...(r.category ? { category: r.category } : {}),
      createdAt: String(r.created_at),
    }))
  }
}
