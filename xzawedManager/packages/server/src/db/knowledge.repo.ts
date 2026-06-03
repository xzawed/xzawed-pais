import type { Pool } from 'pg'

export interface KnowledgeEntry {
  content: string
  sourceAgent: string
  category?: string
  createdAt?: string
  /** 승인 게이트 저장 시 결정을 승인한 사용자 ID(provenance·audit). 그 외 항목은 없음. */
  approver?: string
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
        `INSERT INTO domain_knowledge (project_id, content, source_agent, category, approver) VALUES ($1, $2, $3, $4, $5)`,
        [projectId, e.content, e.sourceAgent, e.category ?? null, e.approver ?? null],
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
    // soft-delete된 행은 기본 제외(deleted_at IS NULL)
    let where = 'WHERE project_id = $1 AND deleted_at IS NULL'
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
      `SELECT id, content, source_agent, category, approver, created_at FROM domain_knowledge
       ${where} ORDER BY created_at DESC LIMIT $${limitIdx}`,
      params,
    )
    return mapRows(res.rows)
  }

  /** soft-delete된 항목만 최근 삭제순으로 조회한다(휴지통/복구 뷰용). */
  async deletedByProject(projectId: string, limit: number): Promise<KnowledgeRecord[]> {
    const res = await this.pool.query(
      `SELECT id, content, source_agent, category, approver, created_at FROM domain_knowledge
       WHERE project_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT $2`,
      [projectId, limit],
    )
    return mapRows(res.rows)
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
   * id로 단일 항목을 soft-delete한다(deleted_at 설정). 누적 지식의 영구 손실을 막아 복구 가능하게 한다.
   * project_id 가드로 타 프로젝트 행은 삭제 불가. 이미 삭제된 행(deleted_at IS NOT NULL)은 재삭제하지 않음.
   * 반환은 실제 삭제 처리된 행이 있는지(rowCount > 0).
   */
  async deleteById(projectId: string, id: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE domain_knowledge SET deleted_at = NOW() WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [id, projectId],
    )
    return (res.rowCount ?? 0) > 0
  }

  /**
   * soft-delete된 항목을 복구한다(deleted_at IS NULL로 되돌림). project_id 가드.
   * 삭제되지 않은 행(deleted_at IS NULL)은 대상이 아니다. 반환은 복구된 행 존재 여부.
   */
  async restoreById(projectId: string, id: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE domain_knowledge SET deleted_at = NULL WHERE id = $1 AND project_id = $2 AND deleted_at IS NOT NULL`,
      [id, projectId],
    )
    return (res.rowCount ?? 0) > 0
  }
}

/** domain_knowledge 행을 KnowledgeRecord로 매핑(recentByProject·deletedByProject 공유). */
function mapRows(rows: unknown[]): KnowledgeRecord[] {
  return (rows as { id: unknown; content: string; source_agent: string; category: string | null; approver?: string | null; created_at: unknown }[]).map((r) => ({
    id: Number(r.id),
    content: r.content,
    sourceAgent: r.source_agent,
    ...(r.category ? { category: r.category } : {}),
    ...(r.approver ? { approver: r.approver } : {}),
    createdAt: String(r.created_at),
  }))
}
