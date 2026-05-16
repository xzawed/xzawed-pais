import type { OrchestratorToManagerMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `orchestrator:to-manager:${sessionId}`

export class StreamProducer {
  private redisUrl: string

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl
  }

  async publish(message: OrchestratorToManagerMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    const id = await redis.xadd(
      streamKey(message.sessionId),
      '*',
      'data',
      JSON.stringify(message)
    )
    return id!
  }
}
