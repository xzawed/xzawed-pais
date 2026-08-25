import type { Pool } from 'pg'
import { z } from 'zod'
import { WorkPackageSchema, assertWpTransition, type WorkPackage, type WpRisk, type WpStatus } from '@xzawed/agent-streams'
import { AbsoluteUserContextSchema, type UserContext } from '../types/user-context.js'

export interface PersistGraphInput {
  workflowId: string
  workPackages: WorkPackage[]
  eventId?: string | null
  /** P4a-2: 워크플로 워크스페이스 컨텍스트 — graph_dag JSONB 내부에 additive 저장(migration 0). */
  userContext?: UserContext | null
  /**
   * S7.2: 이 그래프를 만든 **분해 입력**. `userContext` 와 같은 자리에 additive 로 넣는다(migration 0).
   *
   * 여기 두는 이유. `intent` 는 실행이 만든 사실이 아니라 **그래프를 만든 계획 입력**이라
   * 계획 프로젝션에 속한다(런타임 사실을 별도 투영에 두는 `wp_outputs` 와 반대 방향).
   * 이것이 없으면 `spec_fix`(재분해)가 돌릴 재료 자체가 없다.
   */
  intent?: string | null
}

export interface StoredGraph {
  workflowId: string
  workPackages: WorkPackage[]
  eventId: string | null
  version: number
  /** P4a-2: 레거시 행(키 없음)·파싱 실패는 null — 소비자(워커)는 placeholder 폴백. */
  userContext: UserContext | null
  /** S7.2: 분해 입력. 레거시 행·비문자열은 null — `spec_fix` 는 그때 재분해를 거절한다(fail-closed). */
  intent: string | null
}

export interface WpTransitionInput {
  workflowId: string
  wpId: string
  toState: WpStatus
  fromState?: WpStatus | null
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

  /** 워크플로 그래프 프로젝션 upsert(재분해 시 version++·graph_dag 교체).
   *  G11 Slice 4: tenant_id는 userContext에서 파생(새 인자 없음 → 호출부 누락이 구조적으로 불가능).
   *  재분해가 tenantId 없이 오면 COALESCE로 기존 테넌트를 보존한다(graph_dag 전체 교체와 달리 유실 없음). */
  async upsertGraph(input: PersistGraphInput): Promise<{ version: number }> {
    const dag = JSON.stringify({
      workPackages: input.workPackages,
      ...(input.userContext != null && { userContext: input.userContext }),
      // S7.2: **공백을 걷어낸 뒤** 비면 저장하지 않는다. `.length > 0` 만으로는 `"   "` 가 통과해
      // "분해 입력이 있다"는 거짓 신호가 되고, spec_fix 가 사실상 빈 스펙으로 재분해를 돌린다
      // (Grok 반증이 잡았다 — 트립와이어로 실제 재분해 진입을 확인했다).
      ...(typeof input.intent === 'string' && input.intent.trim().length > 0 && { intent: input.intent.trim() }),
    })
    const { rows } = await this.pool.query<{ version: number }>(
      `INSERT INTO task_graphs (workflow_id, graph_dag, event_id, version, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, NOW(), NOW())
       ON CONFLICT (workflow_id) DO UPDATE
         SET graph_dag  = EXCLUDED.graph_dag,
             event_id   = EXCLUDED.event_id,
             tenant_id  = COALESCE(EXCLUDED.tenant_id, task_graphs.tenant_id),
             version    = task_graphs.version + 1,
             updated_at = NOW()
       RETURNING version`,
      [input.workflowId, dag, input.eventId ?? null, input.userContext?.tenantId ?? null],
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
      graph_dag: { workPackages?: unknown; userContext?: unknown; intent?: unknown } | null
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
    // S7.2: 문자열이 아니거나 **공백뿐이면** null — spec_fix 가 그것으로 재분해를 돌리지 않게 한다.
    // 읽기에서도 거르는 이유는 기존 행에 공백 intent 가 이미 들어가 있을 수 있기 때문이다.
    const rawIntent = row.graph_dag?.intent
    const intent = typeof rawIntent === 'string' && rawIntent.trim().length > 0 ? rawIntent.trim() : null
    return {
      workflowId, workPackages, eventId: row.event_id, version: row.version,
      userContext: ucParsed.success ? ucParsed.data : null,
      intent,
    }
  }

  /** WP 상태 전이를 append-only 기록(INSERT only).
   *  ⚠️ G11 Slice 4: 이 메서드의 wp_state_log INSERT는 tenant_id 컬럼을 채우지 않는다(미태깅) — 프로덕션 호출자
   *  0곳(테스트 전용, dispatch/lease 경로는 dispatch.repo.ts의 appendWpEvent를 쓴다)이라 오늘은 구멍이 아니지만,
   *  나중에 실 호출자가 붙으면 그 writer가 남기는 wp_state_log 행만 영구 미태깅으로 남는다(범위 확대 방지 위해
   *  코드는 그대로 두고 이 주석만 남긴다). */
  async appendTransition(input: WpTransitionInput): Promise<{ seq: number }> {
    // S6.1: `wp_state_log` 의 **두 번째 writer** 다. DB CHECK 는 값만 막고 순서는 못 막으므로
    // dispatch.repo 의 초크포인트와 같은 가드를 여기에도 건다 — 지금 프로덕션 호출자가 0곳이라도
    // 나중에 붙는 writer 가 `DONE → DISPATCHED` 를 조용히 기록하는 구멍을 미리 닫는다.
    assertWpTransition(input.fromState ?? null, input.toState, `appendTransition(${input.wpId})`)
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

  /**
   * P2r-4: graph의 모든 WP risk를 갱신. version 불변(재분해 아님)·WP id 불변
   * (content-hash가 risk 제외·N4)·`userContext` 등 `graph_dag` 형제 키 보존.
   * 그래프 없으면 no-op. risk.approved 소비자가 호출.
   *
   * **단일 UPDATE 로 원자화한다(S6.2).** 예전에는 `getGraph` → JS 로 재조립 → 전체 교체였는데,
   * 읽기와 쓰기 사이에 재분해가 끼면 그 결과를 **통째로 되돌렸다**(lost update). `graph_dag` 를
   * 쓰는 곳이 이 메서드와 `upsertGraph` 둘뿐이라 눈에 잘 띄지 않았고, 재분해가 원래 전량 교체라
   * 증상도 없었다 — 재진입 병합이 들어오면서 **보존한 진행 중 WP 를 되살려 덮는 경로**가 된다.
   * 버전 검사로 탐지하는 대신 창 자체를 없앤다(재시도 루프라는 새 실패 모드도 생기지 않는다).
   */
  async updateWpRisks(workflowId: string, risk: WpRisk): Promise<{ updated: number }> {
    const { rows } = await this.pool.query<{ n: number | string }>(
      `UPDATE task_graphs
          SET graph_dag = jsonb_set(
                graph_dag,
                '{workPackages}',
                (
                  SELECT COALESCE(jsonb_agg(jsonb_set(wp, '{risk}', to_jsonb($2::text)) ORDER BY ord), '[]'::jsonb)
                    FROM jsonb_array_elements(graph_dag->'workPackages') WITH ORDINALITY AS t(wp, ord)
                )
              ),
              updated_at = NOW()
        WHERE workflow_id = $1
          AND jsonb_typeof(graph_dag->'workPackages') = 'array'
        RETURNING jsonb_array_length(graph_dag->'workPackages') AS n`,
      [workflowId, risk],
    )
    const row = rows[0]
    return { updated: row ? Number(row.n) : 0 }
  }
}
