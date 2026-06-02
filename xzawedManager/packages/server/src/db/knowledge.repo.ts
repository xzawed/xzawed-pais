import type { Pool } from 'pg'

export interface KnowledgeEntry {
  content: string
  sourceAgent: string
  category?: string
  createdAt?: string
}

/**
 * 읽기 결과 레코드. KnowledgeEntry에 DB 식별자(id)를 더한 형태.
 * id는 number로 통일한다(전 계층 공유). domain_knowledge.id는 BIGINT지만
 * 프로젝트별 지식 규모상 2^53 초과는 비현실적이므로 정밀도 손실은 허용한다.
 */
export type KnowledgeRecord = KnowledgeEntry & { id: number }

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
  ): Promise<KnowledgeRecord[]> {
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
      `SELECT id, content, source_agent, category, created_at FROM domain_knowledge
       ${where} ORDER BY created_at DESC LIMIT $${limitIdx}`,
      params,
    )
    return (res.rows as { id: unknown; content: string; source_agent: string; category: string | null; created_at: unknown }[]).map((r) => ({
      id: Number(r.id),
      content: r.content,
      sourceAgent: r.source_agent,
      ...(r.category ? { category: r.category } : {}),
      createdAt: String(r.created_at),
    }))
  }

  /**
   * id로 단일 항목의 content·category를 갱신한다. project_id 가드로 타 프로젝트 행은 변조 불가.
   * category=null이면 분류 해제(clear). 반환은 실제 갱신된 행이 있는지(rowCount > 0).
   */
  async updateById(
    projectId: string,
    id: number,
    content: string,
    category: string | null,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE domain_knowledge SET content = $1, category = $2 WHERE id = $3 AND project_id = $4`,
      [content, category, id, projectId],
    )
    return (res.rowCount ?? 0) > 0
  }

  /**
   * id로 단일 항목을 삭제한다. project_id 가드로 타 프로젝트 행은 삭제 불가.
   * 반환은 실제 삭제된 행이 있는지(rowCount > 0).
   */
  async deleteById(projectId: string, id: number): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM domain_knowledge WHERE id = $1 AND project_id = $2`,
      [id, projectId],
    )
    return (res.rowCount ?? 0) > 0
  }
}
