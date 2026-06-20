import { z, type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer, EventEnvelopeSchema } from '@xzawed/agent-streams'
import { GATE_BLOCKED_EVENT } from '../db/release-gate.types.js'
import type { SignoffBriefInfo } from './signoff-brief.js'

const RELEASE_GROUP = 'manager-release-consumers'
const RELEASE_PREFIX = 'manager:release'

/** 느슨한 봉투 — manager:release:main의 모든 gate.* 이벤트 통과. 핸들러가 type으로 분기
 *  (blocked만 처리) — gate.passed를 invalid_schema DLQ로 보내지 않기 위함. */
export const ReleaseEventSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.string(),
  payload: z.record(z.unknown()),
})
export type ReleaseEventMessage = z.infer<typeof ReleaseEventSchema>

/** gate.blocked 페이로드(release-gate.repo recordGate). passthrough()로 추가 필드 보존. */
const GateBlockedPayloadSchema = z.object({
  workflowId: z.string().min(1),
  gateVersion: z.string().min(1),
  blockingReasons: z.array(z.string()).default([]),
  perWp: z.array(z.object({ wpId: z.string(), proven: z.boolean() }).passthrough()).default([]),
})

export interface ReleaseSignoffDeps {
  /** makeSignoffBrief(store, graphStore) — gate.blocked→DecisionRequest. */
  onBlocked: (info: SignoffBriefInfo) => Promise<void>
}

/**
 * gate.blocked 소비 → 사인오프 DecisionRequest. gate.passed는 무시(P5-2b deploy 게이팅). never-throw.
 */
export function buildGateBlockedHandler(deps: ReleaseSignoffDeps): (msg: ReleaseEventMessage) => Promise<void> {
  return async (msg) => {
    try {
      if (msg.type !== GATE_BLOCKED_EVENT) return
      const p = GateBlockedPayloadSchema.safeParse(msg.payload)
      if (!p.success) return
      await deps.onBlocked({
        workflowId: p.data.workflowId,
        gateVersion: p.data.gateVersion,
        blockingReasons: p.data.blockingReasons,
        perWp: p.data.perWp,
      })
    } catch (err) {
      console.warn('[release-consumer] 사인오프 브리프 생성 실패(best-effort·게이트 이벤트는 진실원천):', err)
    }
  }
}

/** gate.blocked 소비자(BaseConsumer·dedup ON). start('main') → manager:release:main. */
export class ReleaseSignoffConsumer extends BaseConsumer<ReleaseEventMessage> {
  constructor(redis: Redis, deps: ReleaseSignoffDeps, sleep?: (ms: number) => Promise<void>) {
    super(
      redis,
      buildGateBlockedHandler(deps),
      RELEASE_GROUP,
      `manager-release-${process.pid}`,
      RELEASE_PREFIX,
      ReleaseEventSchema as ZodType<ReleaseEventMessage>,
      sleep,
    )
  }
}
