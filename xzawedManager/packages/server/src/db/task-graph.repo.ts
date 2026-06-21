import type { Pool } from 'pg'
import { z } from 'zod'
import { WorkPackageSchema, type WorkPackage, type WpRisk } from '@xzawed/agent-streams'
import { AbsoluteUserContextSchema, type UserContext } from '../types/user-context.js'

export interface PersistGraphInput {
  workflowId: string
  workPackages: WorkPackage[]
  eventId?: string | null
  /** P4a-2: 워크플로 워크스페이스 컨텍스트 — graph_dag JSONB 내부에 additive 저장(migration 0). */
  userContext?: UserContext | null
}

export interface StoredGraph {
  workflowId: string
  workPackages: WorkPackage[]
  eventId: string | null
  version: number
  /** P4a-2: 레거시 행(키 없음)·파싱 실패는 null — 소비자(워커)는 placeholder 폴백. */
  userContext: UserContext | null
}

export interface WpTransitionInput {
  workflowId: string
  wpId: string
  toState: string
  fromState?: string | null
  eventId?: string | null
  reason?: string | null
}

export interface WpStateRecord {
  seq: number
  workflowId: string
  wpId: string
  fromState: string | null
  toState: string
  eventId: string | null
  reason: string | null
  occurredAt: number
}

interface WpStateRow {
  seq: number | string
  workflow_id: string
  wp_id: string
  from_state: string | null
  to_state: string
  event_id: string | null
  reason: string | null
  occurred_at: number | string
}

const workPackagesSchema = z.array(WorkPackageSchema)

function mapRow(r: WpStateRow): WpStateRecord {
  return {
    seq: Number(r.seq),
    workflowId: r.workflow_id,
    wpId: r.wp_id,
    fromState: r.from_state,
    toState: r.to_state,
    eventId: r.event_id,
    reason: r.reason,
    occurredAt: Number(r.occurred_at),
  }
}

/** Task Graph 영속 — task_graphs(가변 프로젝션) + wp_state_log(append-only 전이 로그). */
export class TaskGraphRepo {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 워크플로 그래프 프로젝션 upsert(재분해 시 version++·graph_dag 교체). */
  async upsertGraph(input: PersistGraphInput): Promise<{ version: number }> {
    const dag = JSON.stringify({
      workPackages: input.workPackages,
      ...(input.userContext != null && { userContext: input.userContext }),
    })
    const { rows } = await this.pool.query<{ version: number }>(
      `INSERT INTO task_graphs (workflow_id, graph_dag, event_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, 1, NOW(), NOW())
       ON CONFLICT (workflow_id) DO UPDATE
         SET graph_dag  = EXCLUDED.graph_dag,
             event_id   = EXCLUDED.event_id,
             version    = task_graphs.version + 1,
             updated_at = NOW()
       RETURNING version`,
      [input.workflowId, dag, input.eventId ?? null],
    )
    const row = rows[0]
    if (!row) throw new Error('upsertGraph: no row returned')
    return { version: row.version }
  }

  /** 그래프 조회(graph_dag.workPackages를 WorkPackageSchema 배열로 재검증). 없으면 null.
   *  userContext는 safeParse(tolerant) — 레거시 행·손상 데이터가 getGraph 자체(디스패치 경로 포함)를
   *  깨지 않도록 실패 시 null(워커는 placeholder 폴백·우아한 강등). */
  async getGraph(workflowId: string): Promise<StoredGraph | null> {
    const { rows } = await this.pool.query<{
      graph_dag: { workPackages?: unknown; userContext?: unknown } | null
      event_id: string | null
      version: number
    }>(
      `SELECT graph_dag, event_id, version FROM task_graphs WHERE workflow_id = $1`,
      [workflowId],
    )
    const row = rows[0]
    if (!row) return null
    const workPackages = workPackagesSchema.parse(row.graph_dag?.workPackages ?? [])
    const rawUc = row.graph_dag?.userContext
    const ucParsed = AbsoluteUserContextSchema.safeParse(rawUc)
    // 키가 존재하는데 파싱 실패(손상·상대경로)면 강등 사유를 남긴다 — escalate 폭주 원인 추적용.
    // 레거시 행(키 자체 없음)은 정상 경로라 무로그.
    if (rawUc !== undefined && !ucParsed.success) {
      console.warn(`[task-graph] getGraph(${workflowId}): userContext 파싱 실패 — placeholder 강등`, ucParsed.error.issues)
    }
    return {
      workflowId, workPackages, eventId: row.event_id, version: row.version,
      userContext: ucParsed.success ? ucParsed.data : null,
    }
  }

  /** WP 상태 전이를 append-only 기록(INSERT only). */
  async appendTransition(input: WpTransitionInput): Promise<{ seq: number }> {
    const { rows } = await this.pool.query<{ seq: number | string }>(
      `INSERT INTO wp_state_log (workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING seq`,
      [
        input.workflowId, input.wpId, input.fromState ?? null, input.toState,
        input.eventId ?? null, input.reason ?? null, this.now(),
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('appendTransition: no row returned')
    return { seq: Number(row.seq) }
  }

  /** WP별 최신 상태(seq 최대). */
  async latestStates(workflowId: string): Promise<Map<string, WpStateRecord>> {
    const { rows } = await this.pool.query<WpStateRow>(
      `SELECT DISTINCT ON (wp_id) seq, workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at
         FROM wp_state_log
        WHERE workflow_id = $1
        ORDER BY wp_id, seq DESC`,
      [workflowId],
    )
    const out = new Map<string, WpStateRecord>()
    for (const r of rows) out.set(r.wp_id, mapRow(r))
    return out
  }

  /** 한 WP의 전이 이력(seq 오름차순). */
  async transitions(workflowId: string, wpId: string): Promise<WpStateRecord[]> {
    const { rows } = await this.pool.query<WpStateRow>(
      `SELECT seq, workflow_id, wp_id, from_state, to_state, event_id, reason, occurred_at
         FROM wp_state_log
        WHERE workflow_id = $1 AND wp_id = $2
        ORDER BY seq ASC`,
      [workflowId, wpId],
    )
    return rows.map(mapRow)
  }

  /** P2r-4: graph의 모든 WP risk를 갱신(read-modify-write). version 불변(재분해 아님)·WP id 불변
   *  (content-hash가 risk 제외·N4)·userContext 보존. 그래프 없으면 no-op. risk.approved 소비자가 호출. */
  async updateWpRisks(workflowId: string, risk: WpRisk): Promise<{ updated: number }> {
    const stored = await this.getGraph(workflowId)
    if (!stored) return { updated: 0 }
    const updated = stored.workPackages.map((wp) => ({ ...wp, risk }))
    const dag = JSON.stringify({
      workPackages: updated,
      ...(stored.userContext != null && { userContext: stored.userContext }),
    })
    await this.pool.query(
      `UPDATE task_graphs SET graph_dag = $2, updated_at = NOW() WHERE workflow_id = $1`,
      [workflowId, dag],
    )
    return { updated: updated.length }
  }
}
