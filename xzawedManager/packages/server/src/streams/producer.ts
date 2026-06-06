import { RedisEventBus } from '@xzawed/agent-streams'
import type { ManagerToOrchestratorMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`

export class StreamProducer {
  private _bus: RedisEventBus | null = null
  constructor(private readonly redisUrl: string) {}

  /** getRedisClient는 URL별 캐시 클라이언트를 반환 — bus도 1회 생성 후 재사용. */
  private get bus(): RedisEventBus {
    this._bus ??= new RedisEventBus(getRedisClient(this.redisUrl))
    return this._bus
  }

  async publish(message: ManagerToOrchestratorMessage): Promise<string> {
    const stream = streamKey(message.sessionId)
    const id = await this.bus.publish(stream, message)
    if (id === null) throw new Error(`xadd returned null for stream ${stream}`)
    return id
  }

  /** 임의 스트림에 원시 메시지를 발행한다(아웃박스 릴레이용). xadd null 시 throw → 릴레이가 재시도(at-least-once). */
  async publishRaw(stream: string, message: unknown): Promise<void> {
    const id = await this.bus.publish(stream, message)
    if (id === null) throw new Error(`xadd returned null for stream ${stream}`)
  }
}
