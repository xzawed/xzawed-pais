import type { Pool } from 'pg'
import { z } from 'zod'
import { WorkPackageSchema, WpRiskSchema, assertWpTransition, type WorkPackage, type WpRisk, type WpStatus } from '@xzawed/agent-streams'
import { AbsoluteUserContextSchema, type UserContext } from '../types/user-context.js'
import { normalizeIntent } from '../decompose/intent.js'

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
      // S7.2: 보이는 내용이 없으면 저장하지 않는다 — 판정은 `normalizeIntent` 하나로 모았다.
      ...(normalizeIntent(input.intent) !== null && { intent: normalizeIntent(input.intent)! }),
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
    // S7.2: 읽기에서도 정규화한다 — 이 가드가 생기기 전에 저장된 공백 intent 가 행에 남아 있을 수 있다.
    const rawIntent = row.graph_dag?.intent
    const intent = normalizeIntent(rawIntent)
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
   * P2r-4: **WP 별로** risk 를 갱신한다. version 불변(재분해 아님)·WP id 불변
   * (content-hash가 risk 제외·N4)·`userContext` 등 `graph_dag` 형제 키 보존.
   * 그래프 없으면 no-op. risk.approved 소비자가 호출.
   *
   * **맵을 받는다 — 예전에는 등급 하나를 전 WP 에 균일하게 찍었다(결함 F2 · `S5.3b`).**
   * 그러면 `wp.risk` 는 WP 판정이 아니라 프로젝트 최댓값의 사본이고, 그것을 읽는 mutation
   * θ_risk 게이트(`verify.ts`)와 DEGRADED 서명 게이트(`dispatch.ts`)는 판단하는 척만 한다.
   * per-tier θ(`S5.4`)도 전 WP 가 같은 등급이면 단일 θ 로 퇴화한다.
   *
   * **맵에 없는 WP 는 `fallbackRisk` 를 받는다 — 방치하지 않는다.** 처음에는 "판정 없으면 안 쓴다"로
   * 만들었는데 그게 fail-open 이었다(Grok 반증). 변경 전에 영속된 pending 아티팩트에는 WP 판정이
   * 없어서, 사람이 HIGH 로 승인해도 전 WP 가 분해 기본값 MEDIUM 에 머물고 mutation 게이트가
   * **조용히 꺼진다.** F2 는 "보수적이지만 무의미"한 결함이었지 위험한 결함이 아니었다 —
   * 그것을 없애면서 "조용하지만 위험"으로 바꾸면 안 된다. 판정이 있으면 그것을, 없으면 프로젝트
   * 종합 등급을(보수적) 쓴다. 지목 상한(`MAX_WP_HINTS`) 밖 WP 도 같은 이유로 폴백을 받는다.
   *
   * **단일 UPDATE 로 원자화한다(S6.2).** 예전에는 `getGraph` → JS 로 재조립 → 전체 교체였는데,
   * 읽기와 쓰기 사이에 재분해가 끼면 그 결과를 **통째로 되돌렸다**(lost update). `graph_dag` 를
   * 쓰는 곳이 이 메서드와 `upsertGraph` 둘뿐이라 눈에 잘 띄지 않았고, 재분해가 원래 전량 교체라
   * 증상도 없었다 — 재진입 병합이 들어오면서 **보존한 진행 중 WP 를 되살려 덮는 경로**가 된다.
   * 버전 검사로 탐지하는 대신 창 자체를 없앤다(재시도 루프라는 새 실패 모드도 생기지 않는다).
   * 맵으로 바뀌어도 그 성질은 유지한다 — 갱신 값은 SQL 안에서 WP id 로 조회한다.
   *
   * @returns `updated` 는 등급이 쓰인 WP 총수, `judged` 는 그중 **WP 별 판정을 받은** 수다.
   *   `judged === 0` 이면 전부 폴백으로 채워졌다는 뜻 — 호출자가 그 사실을 알 수 있어야 한다
   *   (그 상태를 무음으로 두면 "리스크 체인을 켰는데 등급이 안 갈린다"가 진단 불가가 된다).
   */
  async updateWpRisks(
    workflowId: string, risks: Readonly<Record<string, WpRisk>>, fallbackRisk: WpRisk,
  ): Promise<{ updated: number; judged: number }> {
    // **등급이 아닌 값은 여기서 버린다.** `COALESCE` 는 JSON null 을 SQL NULL 로 보지 않으므로
    // `{a: null}` 이 그대로 `graph_dag` 에 박히고, 그 뒤 `getGraph` 의 Zod 가 **그래프 전체를**
    // 거부해 워크플로가 벽돌이 된다. 오늘은 타입과 `RiskApprovedSchema` 가 이중으로 막지만,
    // 먼 호출자에만 걸린 불변식은 tsc 가 못 보고 새 호출자가 깬다(Grok 반증이 지목한 잔여).
    // 버린 자리는 판정 없음으로 취급돼 폴백을 받는다 — 보수적 방향이다.
    const safe: Record<string, WpRisk> = {}
    for (const [id, r] of Object.entries(risks)) {
      if (WpRiskSchema.safeParse(r).success) safe[id] = r
    }
    const { rows } = await this.pool.query<{ n: number | string; j: number | string }>(
      `UPDATE task_graphs
          SET graph_dag = jsonb_set(
                graph_dag,
                '{workPackages}',
                (
                  SELECT COALESCE(jsonb_agg(
                           jsonb_set(wp, '{risk}', COALESCE($2::jsonb -> (wp->>'id'), to_jsonb($3::text)))
                           ORDER BY ord), '[]'::jsonb)
                    FROM jsonb_array_elements(graph_dag->'workPackages') WITH ORDINALITY AS t(wp, ord)
                )
              ),
              updated_at = NOW()
        WHERE workflow_id = $1
          AND jsonb_typeof(graph_dag->'workPackages') = 'array'
        RETURNING
          jsonb_array_length(graph_dag->'workPackages') AS n,
          (
            SELECT COUNT(*) FROM jsonb_array_elements(graph_dag->'workPackages') AS e(wp)
             WHERE $2::jsonb ? (wp->>'id')
          ) AS j`,
      [workflowId, JSON.stringify(safe), fallbackRisk],
    )
    const row = rows[0]
    return { updated: row ? Number(row.n) : 0, judged: row ? Number(row.j) : 0 }
  }
}
