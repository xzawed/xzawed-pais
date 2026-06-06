import { z } from 'zod'
import { RedisEventBus } from '@xzawed/agent-streams'
import { getRedisClient } from '../streams/redis.client.js'

const TIMEOUT_MS = 30_000
const REQUEST_STREAM = 'manager:to-orchestrator:projects'

const ProjectResponseSchema = z.object({
  type: z.string(),
  sessionId: z.string(),
  payload: z.unknown(),
})

/**
 * 프로젝트 RPC 공통 라운드트립(switch_project·register_project 공유).
 * 응답 스트림 tip 캡처(레이스 방지) → 요청 발행 → 비그룹 폴링으로 응답 대기.
 * `responseType` 수신 시 `parseOutput`로 파싱·반환, `project_error`(동일 sessionId)면 throw, 타임아웃(30s) throw.
 * 전송은 `RequestReplyPort`(RedisEventBus)에 위임 — 도메인 스키마/타입만 호출자가 제공.
 */
export async function requestProjectReply<T>(opts: {
  redisUrl: string
  sessionId: string
  requestType: string
  responseType: string
  payload: unknown
  parseOutput: (payload: unknown) => T
  label: string
}): Promise<T> {
  const bus = new RedisEventBus(getRedisClient(opts.redisUrl))
  const responseStream = `orchestrator:to-manager:projects:${opts.sessionId}`

  // Capture stream tip before publishing to avoid missing responses in the race window
  let lastId = await bus.streamTip(responseStream)

  await bus.publish(REQUEST_STREAM, {
    type: opts.requestType,
    sessionId: opts.sessionId,
    messageId: crypto.randomUUID(),
    timestamp: Date.now(),
    payload: opts.payload,
  })

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const blockMs = Math.min(deadline - Date.now(), 5_000)
    if (blockMs <= 0) break

    const results = await bus.readFrom(responseStream, lastId, { count: 5, blockMs })
    if (!results) continue

    for (const [, messages] of results) {
      for (const [msgId, fields] of messages) {
        lastId = msgId
        const dataIdx = fields.indexOf('data')
        if (dataIdx === -1) continue
        const raw = fields[dataIdx + 1]
        if (!raw) continue

        let parseResult
        try {
          parseResult = ProjectResponseSchema.safeParse(JSON.parse(raw))
        } catch {
          continue // malformed JSON, skip
        }
        if (!parseResult.success) continue

        const msg = parseResult.data
        if (msg.type === opts.responseType) {
          return opts.parseOutput(msg.payload)
        }
        if (msg.type === 'project_error' && msg.sessionId === opts.sessionId) {
          const err = (msg.payload as { error?: string }).error ?? 'unknown error'
          throw new Error(`${opts.label} failed: ${err}`)
        }
      }
    }
  }

  throw new Error(`${opts.label} timed out after 30s`)
}
