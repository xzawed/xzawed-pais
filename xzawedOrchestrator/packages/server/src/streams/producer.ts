import type { OrchestratorToManagerMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const streamKey = (sessionId: string) => `orchestrator:to-manager:${sessionId}`

const RETRY_DELAYS = [100, 200, 400]

export class StreamProducer {
  private readonly redisUrl: string

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl
  }

  async publish(message: OrchestratorToManagerMessage): Promise<string> {
    if (!UUID_V4_RE.test(message.sessionId)) {
      throw new Error(`Invalid sessionId format: ${message.sessionId}`)
    }
    const redis = getRedisClient(this.redisUrl)
    let lastErr: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const id = await redis.xadd(
          streamKey(message.sessionId),
          '*',
          'data',
          JSON.stringify(message)
        )
        if (id === null) throw new Error('Redis xadd returned null — stream may be at MAXLEN')
        return id
      } catch (err) {
        lastErr = err
        if (attempt < RETRY_DELAYS.length) {
          await new Promise<void>(r => setTimeout(r, RETRY_DELAYS[attempt]))
        }
      }
    }
    throw lastErr
  }

  async publishSessionGateway(sessionId: string): Promise<void> {
    if (!UUID_V4_RE.test(sessionId)) {
      throw new Error(`Invalid sessionId format: ${sessionId}`)
    }
    const redis = getRedisClient(this.redisUrl)
    let lastErr: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const id = await redis.xadd(
          'orchestrator:to-manager:sessions',
          '*',
          'data',
          JSON.stringify({ sessionId, timestamp: Date.now() }),
        )
        if (id === null) throw new Error('Redis xadd returned null — stream may be at MAXLEN')
        return
      } catch (err) {
        lastErr = err
        if (attempt < RETRY_DELAYS.length) {
          await new Promise<void>(r => setTimeout(r, RETRY_DELAYS[attempt]))
        }
      }
    }
    throw lastErr
  }
}
