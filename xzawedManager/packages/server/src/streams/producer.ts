import type { ManagerToOrchestratorMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`

export class StreamProducer {
  constructor(private readonly redisUrl: string) {}

  async publish(message: ManagerToOrchestratorMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    const id = await redis.xadd(
      streamKey(message.sessionId),
      '*',
      'data',
      JSON.stringify(message)
    )
    if (id === null) throw new Error(`xadd returned null for stream ${streamKey(message.sessionId)}`)
    return id
  }
}
