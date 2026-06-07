import type { Pool } from 'pg'
import { z } from 'zod'
import { WorkPackageSchema, type WorkPackage } from '@xzawed/agent-streams'

export interface PersistGraphInput {
  workflowId: string
  workPackages: WorkPackage[]
  eventId?: string | null
}

export interface StoredGraph {
  workflowId: string
  workPackages: WorkPackage[]
  eventId: string | null
  version: number
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
  async upsertGraph(_input: PersistGraphInput): Promise<{ version: number }> {
    throw new Error('not implemented')
  }

  /** 그래프 조회(graph_dag.workPackages를 WorkPackageSchema 배열로 재검증). 없으면 null. */
  async getGraph(_workflowId: string): Promise<StoredGraph | null> {
    throw new Error('not implemented')
  }

  /** WP 상태 전이를 append-only 기록(INSERT only). */
  async appendTransition(_input: WpTransitionInput): Promise<{ seq: number }> {
    throw new Error('not implemented')
  }

  /** WP별 최신 상태(seq 최대). */
  async latestStates(_workflowId: string): Promise<Map<string, WpStateRecord>> {
    throw new Error('not implemented')
  }

  /** 한 WP의 전이 이력(seq 오름차순). */
  async transitions(_workflowId: string, _wpId: string): Promise<WpStateRecord[]> {
    throw new Error('not implemented')
  }
}
