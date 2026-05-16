import { Redis } from 'ioredis'
import { z } from 'zod'
import type { AnthropicInputSchema, ToolHandler } from './handler.interface.js'

const DEFAULT_TIMEOUT_MS = 120_000
const BLOCK_STEP_MS = 5_000

export class RedisAgentHandler<TInput, TOutput>
  implements ToolHandler<TInput, TOutput> {

  private _redis: Redis | null = null

  constructor(
    private readonly redisUrl: string,
    private readonly agentName: string,
    private readonly requestType: string,
    private readonly completeType: string,
    public readonly name: string,
    public readonly description: string,
    public readonly inputSchema: AnthropicInputSchema,
    private readonly outputSchema: z.ZodType<TOutput>,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private get redis(): Redis {
    if (!this._redis) {
      this._redis = new Redis(this.redisUrl)
    }
    return this._redis
  }

  async execute(input: TInput, sessionId: string): Promise<TOutput> {
    const requestStream = `manager:to-${this.agentName}:${sessionId}`
    const responseStream = `${this.agentName}:to-manager:${sessionId}`

    // Get tip BEFORE sending to avoid missing responses in the race window
    const tip = await this.redis.xrevrange(
      responseStream, '+', '-', 'COUNT', '1',
    ) as [string, string[]][]
    let lastId = tip[0]?.[0] ?? '0-0'

    await this.redis.xadd(requestStream, '*', 'data', JSON.stringify({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: this.requestType,
      payload: input,
    }))

    const deadline = Date.now() + this.timeoutMs

    while (Date.now() < deadline) {
      const blockMs = Math.min(deadline - Date.now(), BLOCK_STEP_MS)
      if (blockMs <= 0) break

      const results = await this.redis.xread(
        'COUNT', '10', 'BLOCK', String(blockMs),
        'STREAMS', responseStream, lastId,
      ) as unknown as [string, [string, string[]][]][] | null

      if (!results) continue

      for (const [, messages] of results) {
        for (const [msgId, fields] of messages) {
          lastId = msgId

          const dataIdx = fields.indexOf('data')
          if (dataIdx === -1) continue

          const raw = fields[dataIdx + 1]
          if (raw === undefined) continue

          const msg = JSON.parse(raw) as { type: string; payload: Record<string, unknown> }

          if (msg.type === 'error') {
            throw new Error(String(msg.payload['content'] ?? `${this.agentName} error`))
          }

          // Phase 1: relay clarification request as error so Claude's request_info tool handles it
          if (msg.type === 'info_request') {
            throw new Error(
              `Clarification needed from ${this.agentName}: ${String(msg.payload['content'] ?? 'details required')}`,
            )
          }

          if (msg.type === this.completeType) {
            return this.outputSchema.parse(msg.payload)
          }
          // skip other types (e.g., build_progress)
        }
      }
    }

    throw new Error(`${this.agentName} timed out after ${this.timeoutMs}ms`)
  }
}
