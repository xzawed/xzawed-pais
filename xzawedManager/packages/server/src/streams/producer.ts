import type { ManagerToOrchestratorMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`

const RETRY_DELAYS = [100, 200, 400]

async function withXaddRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < RETRY_DELAYS.length) {
        await new Promise<void>(r => setTimeout(r, RETRY_DELAYS[attempt]))
      }
    }
  }
  throw lastErr
}

export class StreamProducer {
  constructor(private readonly redisUrl: string) {}

  async publish(message: ManagerToOrchestratorMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    return withXaddRetry(async () => {
      const id = await redis.xadd(streamKey(message.sessionId), '*', 'data', JSON.stringify(message))
      if (id === null) throw new Error(`xadd returned null for stream ${streamKey(message.sessionId)}`)
      return id
    })
  }
}
