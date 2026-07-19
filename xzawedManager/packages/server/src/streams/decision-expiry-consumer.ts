import { z, type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer } from '@xzawed/agent-streams'
import { DECISION_EXPIRED_EVENT, type DecisionRequest } from '../db/decision.types.js'
import { DecisionEventSchema, groupScopedDedupKey, type DecisionEventMessage } from './decision-consumer.js'

// ---------------------------------------------------------------------------
// Task 1: 재에스컬 깊이 헬퍼 (순수)
// ---------------------------------------------------------------------------

const REESC_SUFFIX = /:reesc(\d+)$/

/** 재에스컬 깊이: 접미사 :reesc{n} → n, 없으면 0. */
export function parseReescDepth(requestId: string): number {
  const m = REESC_SUFFIX.exec(requestId)
  return m ? Number(m[1]) : 0
}

/** 끝의 :reesc{n} 제거 — 체인을 원본 base에 고정(멱등키 안정). */
export function stripReescSuffix(requestId: string): string {
  return requestId.replace(REESC_SUFFIX, '')
}

/** 다음 재에스컬 requestId(base:reesc{depth+1}). */
export function nextReescId(requestId: string): string {
  return `${stripReescSuffix(requestId)}:reesc${parseReescDepth(requestId) + 1}`
}

// ---------------------------------------------------------------------------
// Task 2: buildDecisionExpiredHandler (재에스컬 로직)
// ---------------------------------------------------------------------------

const ExpiredPayloadSchema = z.object({ requestId: z.string().min(1) })

export interface DecisionExpiryStore {
  getRequest(requestId: string): Promise<DecisionRequest | null>
  createRequest(req: {
    requestId: string
    type: DecisionRequest['type']
    workflowId: string
    correlationId: string
    wpId?: string | null
    context?: DecisionRequest['context']
    severity?: DecisionRequest['severity']
    language?: string
    expiresAt?: string | null
    projectId?: string | null
    /** G11 Slice 4: 재에스컬레이션은 원 요청의 테넌트를 승계(아래 buildDecisionExpiredHandler). */
    tenantId?: string | null
  }): Promise<{ eventId: string } | null>
}

export interface DecisionExpiryDeps {
  decisionStore: DecisionExpiryStore
  maxReescalations: number
  ttlMs: number
  now?: () => number
}

/**
 * decision.expired 소비 → 바운드 재에스컬레이션. blocking 결정만 재에스컬(advisory 드롭).
 * depth < max면 새 PENDING(base:reesc{depth+1}·expiresAt=now+ttl·orig 필드 복사)→C1 재노출.
 * depth >= max면 구조적 warn 로그(EXPIRED 종단). never-throw(결정은 이미 영속·소비자 생존).
 */
export function buildDecisionExpiredHandler(deps: DecisionExpiryDeps): (msg: DecisionEventMessage) => Promise<void> {
  return async (msg) => {
    try {
      if (msg.type !== DECISION_EXPIRED_EVENT) return
      const p = ExpiredPayloadSchema.safeParse(msg.payload)
      if (!p.success) return
      const req = await deps.decisionStore.getRequest(p.data.requestId)
      if (!req) return
      if (req.severity !== 'blocking') return
      const depth = parseReescDepth(req.requestId)
      if (depth >= deps.maxReescalations) {
        console.warn(
          `[decision-expiry] 재에스컬 상한(${deps.maxReescalations}) 소진 — 종단: requestId=${req.requestId} workflowId=${req.workflowId} type=${req.type} depth=${depth}`,
        )
        return
      }
      const nowMs = deps.now?.() ?? Date.now()
      const attempt = depth + 1
      await deps.decisionStore.createRequest({
        requestId: nextReescId(req.requestId),
        type: req.type,
        workflowId: req.workflowId,
        correlationId: req.correlationId,
        wpId: req.wpId,
        projectId: req.projectId,
        // G11 Slice 4: 테넌트는 **원 요청 행**에서 승계한다(이 소비자에 userContext가 없고,
        // 있더라도 원 요청의 테넌트가 정답 — 재에스컬레이션은 같은 결정의 연장이다).
        tenantId: req.tenantId,
        severity: req.severity,
        language: req.language,
        context: {
          ...req.context,
          impact: [...req.context.impact, `re-escalated from ${req.requestId} (attempt ${attempt})`],
        },
        expiresAt: new Date(nowMs + deps.ttlMs).toISOString(),
      })
    } catch (err) {
      console.warn('[decision-expiry] 재에스컬 실패(best-effort·결정은 EXPIRED 영속):', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Task 3: DecisionExpiredConsumer (BaseConsumer 서브클래스)
// ---------------------------------------------------------------------------

const EXPIRY_GROUP = 'manager-decision-expiry-consumers'
const DECISION_PREFIX = 'manager:decision'

/** decision.expired 소비자(BaseConsumer·dedup ON·그룹-스코프 dedup 키). start('main') → manager:decision:main. */
export class DecisionExpiredConsumer extends BaseConsumer<DecisionEventMessage> {
  constructor(redis: Redis, deps: DecisionExpiryDeps, sleep?: (ms: number) => Promise<void>) {
    super(
      redis,
      buildDecisionExpiredHandler(deps),
      EXPIRY_GROUP,
      `manager-decision-expiry-${process.pid}`,
      DECISION_PREFIX,
      DecisionEventSchema as ZodType<DecisionEventMessage>,
      sleep,
      true,
      3,
      { key: (m) => groupScopedDedupKey(EXPIRY_GROUP, m) },
    )
  }
}
