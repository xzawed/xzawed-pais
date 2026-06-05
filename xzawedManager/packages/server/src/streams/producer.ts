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

  /** 임의 스트림에 원시 메시지를 발행한다(아웃박스 릴레이용). */
  async publishRaw(stream: string, message: unknown): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    await redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
