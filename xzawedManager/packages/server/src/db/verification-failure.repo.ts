import type { Pool } from 'pg'

/** 브리프에 실을 실패 사유의 상한 — 오래된 attempt 부터 잘라낸다(사람이 읽을 분량). */
export const FAILURE_BRIEF_LIMIT = 5

/** 워커가 남기는 검증 실패 한 건. */
export interface VerificationFailureInput {
  workflowId: string
  wpId: string
  attempt: number
  reason: string
  tenantId: string | null
}

export interface VerificationFailureRow {
  attempt: number
  reason: string
}

/**
 * **검증 실패 사유 투영**(S7.1 / 결함 F5).
 *
 * `wp_verification_results`(채널 증거)와 표를 나눈 이유. 그쪽은 **통과한 채널의 증거**를
 * `(wf, wp, attempt, channel)` 로 남기는 릴리스 게이트 입력이고, 이쪽은 **WP 단위 실패 사유**다.
 * `verifyWp` 는 첫 실패에서 단락해 단일 verdict 를 돌려주므로 어느 채널이 실패했는지가 구조적으로
 * 남지 않는다 — 사유 문자열의 접두사를 파싱해 채널을 복원하는 것은 깨지기 쉬운 결합이라 하지 않는다.
 */
export class VerificationFailureRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * 실패 사유 1건 기록. 같은 attempt 재기록은 멱등(첫 사유 보존 — reclaim 후 좀비 응답이
   * 원래 사유를 덮지 않게 한다).
   */
  async record(input: VerificationFailureInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO wp_verification_failures (workflow_id, wp_id, attempt, reason, tenant_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workflow_id, wp_id, attempt) DO NOTHING`,
      [input.workflowId, input.wpId, input.attempt, input.reason, input.tenantId],
    )
  }

  /** 이 WP 의 실패 사유를 attempt 오름차순으로(최근 `limit` 건). 없으면 빈 배열. */
  async recentForWp(workflowId: string, wpId: string, limit = FAILURE_BRIEF_LIMIT): Promise<VerificationFailureRow[]> {
    const { rows } = await this.pool.query<{ attempt: number; reason: string }>(
      `SELECT attempt, reason
         FROM (
           SELECT attempt, reason
             FROM wp_verification_failures
            WHERE workflow_id = $1 AND wp_id = $2
            ORDER BY attempt DESC
            LIMIT $3
         ) t
        ORDER BY attempt ASC`,
      [workflowId, wpId, limit],
    )
    return rows.map((r) => ({ attempt: Number(r.attempt), reason: r.reason }))
  }
}
