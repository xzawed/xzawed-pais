import type { ManagerToOrchestratorMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`

const XADD_RETRY_DELAYS_MS = [100, 200, 400]

export class StreamProducer {
  constructor(private readonly redisUrl: string) {}

  async publish(message: ManagerToOrchestratorMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    const key = streamKey(message.sessionId)
    let lastErr: unknown
    for (let i = 0; i <= XADD_RETRY_DELAYS_MS.length; i++) {
      try {
        const id = await redis.xadd(key, '*', 'data', JSON.stringify(message))
        if (id === null) throw new Error(`xadd returned null for stream ${key}`)
        return id
      } catch (err) {
        lastErr = err
        if (i < XADD_RETRY_DELAYS_MS.length) {
          await new Promise<void>(r => setTimeout(r, XADD_RETRY_DELAYS_MS[i]))
        }
      }
    }
    throw lastErr
  }
}
