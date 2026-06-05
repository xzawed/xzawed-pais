import { z } from 'zod'
import type { CollabMessage } from '../streams/collaboration.js'

/**
 * 이벤트 봉투 — M4 event-sourcing 토대(senario 사양 §18-2).
 * 현 `CollabMessage`를 깨지 않는 **additive 메타**로, 멱등(M6)·인과 추적(M7)·워크플로 상관을 표준화한다.
 *
 * ⚠️ 이 단계(P0 토대)는 **정의·헬퍼·테스트만** 제공한다. 기존 메시지 흐름에 봉투를 강제 배선하는 것은
 * P0 이벤트소싱 단계(WP0 잔여 결정 후)에서 한다. 그때까지 봉투는 선택적으로 동반된다.
 */
export const EventEnvelopeSchema = z.object({
  /** 도메인 이벤트 고유 식별(전송 단위 messageId와 별개). */
  eventId: z.string().uuid(),
  /** 전체 워크플로 상관키(M7). 한 워크플로의 모든 이벤트가 공유. */
  correlationId: z.string().min(1),
  /** 이 이벤트를 유발한 직전 이벤트의 eventId(M7 인과 체인). 루트 이벤트는 null. */
  causationId: z.string().min(1).nullable(),
  /** `{workflowId}:{stepId}:{attemptId}` — 재시도 멱등(M6). */
  idempotencyKey: z.string().min(1),
  workflowId: z.string().min(1),
  stepId: z.string().min(1),
  /** 재시도 횟수(0부터). 멱등 키 구성요소. */
  attemptId: z.number().int().nonnegative(),
  /** 발생 시각(epoch ms). 이벤트 정렬 기준. */
  occurredAt: z.number().int().nonnegative(),
})

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>

/** `makeEnvelope` 입력 — 호출자 제공 식별·상관 정보. eventId·idempotencyKey·occurredAt은 자동 생성. */
export interface EnvelopeParts {
  correlationId: string
  causationId?: string | null
  workflowId: string
  stepId: string
  attemptId: number
}

/** 봉투를 선택적으로 동반하는 메시지(점진 채택). 기존 메시지는 envelope 없이도 유효. */
export type EnvelopedMessage = CollabMessage & { envelope?: EventEnvelope }

/**
 * 이벤트 봉투를 생성한다. `eventId`(uuid v4)·`idempotencyKey`(`{workflowId}:{stepId}:{attemptId}`)·`occurredAt`을 채운다.
 * @param now 테스트 주입용 발생 시각(미지정 시 `Date.now()`).
 */
export function makeEnvelope(parts: EnvelopeParts, now: number = Date.now()): EventEnvelope {
  return {
    eventId: crypto.randomUUID(),
    correlationId: parts.correlationId,
    causationId: parts.causationId ?? null,
    idempotencyKey: `${parts.workflowId}:${parts.stepId}:${parts.attemptId}`,
    workflowId: parts.workflowId,
    stepId: parts.stepId,
    attemptId: parts.attemptId,
    occurredAt: now,
  }
}
