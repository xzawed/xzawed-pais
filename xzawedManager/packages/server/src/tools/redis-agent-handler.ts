import { z } from 'zod'
import type { AnthropicInputSchema, ToolHandler } from './handler.interface.js'
import type { UserContext } from '../types/user-context.js'
import { getRedisClient } from '../streams/redis.client.js'
import type { Redis } from 'ioredis'
import { ClarificationNeededError } from './errors.js'

const DEFAULT_TIMEOUT_MS = 120_000
const BLOCK_STEP_MS = 5_000

type ParsedMessage = { type: string; payload: Record<string, unknown> }

export class RedisAgentHandler<TInput, TOutput>
  implements ToolHandler<TInput, TOutput> {

  private _redis: Redis | null = null
  private readonly _notifiedSessions = new Set<string>()

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
    this._redis ??= getRedisClient(this.redisUrl)
    return this._redis
  }

  private async ensureSessionStream(requestStream: string): Promise<void> {
    const group = `${this.agentName}-consumers`
    try {
      await this.redis.xgroup('CREATE', requestStream, group, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }
  }

  private async notifyGateway(sessionId: string): Promise<void> {
    const gatewayStream = `manager:to-${this.agentName}:sessions`
    await this.redis.xadd(gatewayStream, '*', 'data', JSON.stringify({
      sessionId,
      timestamp: Date.now(),
    }))
  }

  private async getStreamTip(responseStream: string): Promise<string> {
    const tip = await this.redis.xrevrange(
      responseStream, '+', '-', 'COUNT', '1',
    ) as [string, string[]][]
    return tip[0]?.[0] ?? '0-0'
  }

  private async publishRequest(
    requestStream: string,
    sessionId: string,
    input: TInput,
    userContext?: UserContext,
  ): Promise<void> {
    const payload = userContext !== undefined
      ? { ...(input as Record<string, unknown>), userContext }
      : input
    await this.redis.xadd(requestStream, '*', 'data', JSON.stringify({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: this.requestType,
      payload,
    }))
  }

  private parseRawMessage(fields: string[]): ParsedMessage | null {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) return null
    const raw = fields[dataIdx + 1]
    if (raw === undefined) return null
    try {
      return JSON.parse(raw) as ParsedMessage
    } catch {
      return null
    }
  }

  /** Returns the resolved output, throws on error/info_request, returns null to continue polling. */
  private handleMessage(msg: ParsedMessage): TOutput | null {
    if (msg.type === 'error') {
      throw new Error(String(msg.payload['content'] ?? `${this.agentName} error`))
    }
    if (msg.type === 'info_request') {
      throw new ClarificationNeededError(
        String(msg.payload['content'] ?? 'details required'),
        msg.payload['uiSpec'],
      )
    }
    if (msg.type === this.completeType) {
      return this.outputSchema.parse(msg.payload)
    }
    return null // skip other types (e.g., build_progress)
  }

  private processStreamResults(
    results: [string, [string, string[]][]][],
    lastId: string,
  ): { lastId: string; output: TOutput | null } {
    let currentLastId = lastId
    for (const [, messages] of results) {
      for (const [msgId, fields] of messages) {
        currentLastId = msgId
        const msg = this.parseRawMessage(fields)
        if (msg === null) continue
        const output = this.handleMessage(msg)
        if (output !== null) {
          return { lastId: currentLastId, output }
        }
      }
    }
    return { lastId: currentLastId, output: null }
  }

  async execute(input: TInput, sessionId: string, userContext?: UserContext): Promise<TOutput> {
    const requestStream = `manager:to-${this.agentName}:${sessionId}`
    const responseStream = `${this.agentName}:to-manager:${sessionId}`

    const notifyKey = `${this.agentName}:${sessionId}`
    if (!this._notifiedSessions.has(notifyKey)) {
      await this.ensureSessionStream(requestStream)
      await this.notifyGateway(sessionId)
      this._notifiedSessions.add(notifyKey)
    }

    // Get tip BEFORE sending to avoid missing responses in the race window
    let lastId = await this.getStreamTip(responseStream)
    await this.publishRequest(requestStream, sessionId, input, userContext)

    const deadline = Date.now() + this.timeoutMs

    while (Date.now() < deadline) {
      const blockMs = Math.min(deadline - Date.now(), BLOCK_STEP_MS)
      if (blockMs <= 0) break

      const results = await this.redis.xread(
        'COUNT', '10', 'BLOCK', String(blockMs),
        'STREAMS', responseStream, lastId,
      )

      if (!results) continue

      const { lastId: updatedId, output } = this.processStreamResults(
        results as [string, [string, string[]][]][],
        lastId,
      )
      lastId = updatedId
      if (output !== null) return output
    }

    throw new Error(`${this.agentName} timed out after ${this.timeoutMs}ms`)
  }

  releaseSession(sessionId: string): void {
    const notifyKey = `${this.agentName}:${sessionId}`
    this._notifiedSessions.delete(notifyKey)
  }

  async close(): Promise<void> {
    // _redis is a cached client from getRedisClient; do not quit it here.
    // Lifecycle is managed by closeRedisClients() at process shutdown.
    this._redis = null
    this._notifiedSessions.clear()
  }
}
