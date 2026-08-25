import type { Pool } from 'pg'

/**
 * 하나의 WP 가 후행에 넘길 수 있는 산출물 상한(S6.3).
 *
 * 에이전트가 낸 경로 배열을 그대로 후행 입력으로 흘리면, 대규모 변경 하나가 뒤따르는 모든 WP 의
 * 입력을 부풀리고 security static 이 그만큼 파일을 연다. 상한을 넘으면 자르되 **자른 사실이
 * 집계에 드러나야 한다** — Security 의 `requested` 는 받은 개수라 잘린 값이 그대로 보인다.
 */
export const MAX_WP_OUTPUTS = 200

export interface WpOutputInput {
  workflowId: string
  wpId: string
  artifacts: string[]
  tenantId: string | null
}

/**
 * **WP 실제 산출물 투영**(S6.3 / 결함 F7).
 *
 * 워커가 성공한 WP 의 결과 artifacts 를 여기 쓰고, 후행 WP 를 디스패치할 때 그 WP 의
 * `dependencies` 산출물을 모아 에이전트 입력의 `artifacts` 로 넘긴다.
 *
 * upsert 인 이유. 같은 WP 가 재시도(attempt++)로 다시 성공하면 **최신 성공 실행이 진실**이다 —
 * attempt 별로 쌓으면 후행이 옛 실행의 파일까지 감사하게 된다.
 */
export class WpOutputRepo {
  constructor(private readonly pool: Pool) {}

  /** 성공한 WP 의 산출물 기록(덮어쓰기). 빈 배열도 기록한다 — "산출물이 없었다"는 사실도 사실이다. */
  async record(input: WpOutputInput): Promise<void> {
    const artifacts = input.artifacts.slice(0, MAX_WP_OUTPUTS)
    await this.pool.query(
      `INSERT INTO wp_outputs (workflow_id, wp_id, artifacts, tenant_id, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (workflow_id, wp_id)
       DO UPDATE SET artifacts = EXCLUDED.artifacts, tenant_id = COALESCE(EXCLUDED.tenant_id, wp_outputs.tenant_id), updated_at = NOW()`,
      [input.workflowId, input.wpId, JSON.stringify(artifacts), input.tenantId],
    )
  }

  /**
   * 주어진 WP 들의 산출물 합집합(중복 제거·순서 안정). 빈 목록이면 왕복 0.
   *
   * 합집합인 이유. 후행 WP 의 입력은 "선행들이 만든 것 전부"다 — 어느 선행이 냈는지는 감사 대상을
   * 정하는 데 필요 없고, 파일 단위로 중복되면 같은 파일을 두 번 감사하게 된다.
   */
  async unionFor(workflowId: string, wpIds: string[]): Promise<string[]> {
    if (wpIds.length === 0) return []
    const { rows } = await this.pool.query<{ artifacts: string[] }>(
      `SELECT artifacts FROM wp_outputs WHERE workflow_id = $1 AND wp_id = ANY($2::text[]) ORDER BY wp_id`,
      [workflowId, wpIds],
    )
    const seen = new Set<string>()
    for (const r of rows) {
      for (const a of Array.isArray(r.artifacts) ? r.artifacts : []) {
        if (typeof a === 'string' && a.length > 0) seen.add(a)
      }
    }
    return [...seen].slice(0, MAX_WP_OUTPUTS)
  }
}
