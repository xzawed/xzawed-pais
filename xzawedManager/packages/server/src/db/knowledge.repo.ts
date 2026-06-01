import type { Pool } from 'pg'

export interface KnowledgeEntry {
  content: string
  sourceAgent: string
}

/** 프로젝트 단위 도메인 지식(domain_knowledge) 저장소. SessionRepo와 동일 패턴. */
export class KnowledgeRepo {
  constructor(private readonly pool: Pool) {}

  async insertMany(projectId: string, entries: KnowledgeEntry[]): Promise<void> {
    for (const e of entries) {
      await this.pool.query(
        `INSERT INTO domain_knowledge (project_id, content, source_agent) VALUES ($1, $2, $3)`,
        [projectId, e.content, e.sourceAgent],
      )
    }
  }

  async recentByProject(projectId: string, limit: number): Promise<KnowledgeEntry[]> {
    const res = await this.pool.query(
      `SELECT content, source_agent FROM domain_knowledge
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit],
    )
    return (res.rows as { content: string; source_agent: string }[]).map((r) => ({
      content: r.content,
      sourceAgent: r.source_agent,
    }))
  }
}
