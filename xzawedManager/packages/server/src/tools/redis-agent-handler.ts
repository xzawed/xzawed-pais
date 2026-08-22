import { z } from 'zod'
import type { AnthropicInputSchema, ToolHandler } from './handler.interface.js'
import type { UserContext } from '../types/user-context.js'
import { getRedisClient } from '../streams/redis.client.js'
import type { Redis } from 'ioredis'
import { RedisEventBus } from '@xzawed/agent-streams'
import type { RequestReplyPort, Bulkhead } from '@xzawed/agent-streams'
import { ClarificationNeededError, AgentQueryError } from './errors.js'

const DEFAULT_TIMEOUT_MS = 120_000
const BLOCK_STEP_MS = 5_000

type ParsedMessage = { type: string; payload: Record<string, unknown> }

export class RedisAgentHandler<TInput, TOutput>
  implements ToolHandler<TInput, TOutput> {

  private _redis: Redis | null = null
  private _bus: RequestReplyPort | null = null
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
    // §13 벌크헤드(optional). 주입 시 agentName(에이전트 종류) 키로 동시 RPC를 캡·큐잉. 미주입이면 직접 실행(회귀 0).
    private readonly bulkhead?: Bulkhead,
  ) {}

  private get redis(): Redis {
    this._redis ??= getRedisClient(this.redisUrl)
    return this._redis
  }

  /** RPC 전송 포트(streamTip·publish·readFrom). 캐시 클라이언트 위 1회 생성. */
  private get bus(): RequestReplyPort {
    this._bus ??= new RedisEventBus(this.redis)
    return this._bus
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

  /**
   * 세션 종료 통지. `sessionId` 키를 **쓰지 않는다** — 구 SessionDispatcher는
   * `typeof parsed.sessionId === 'string'`만 보고 세션을 띄우므로, 그 키가 실려 있으면
   * 종료 통지가 종료된 세션의 소비자를 부활시킨다. 계약 정본은 shared의
   * `GatewayEndSchema`이고 이 페이로드가 그것을 만족해야 한다.
   */
  private async endGateway(sessionId: string): Promise<void> {
    const gatewayStream = `manager:to-${this.agentName}:sessions`
    const id = await this.redis.xadd(gatewayStream, '*', 'data', JSON.stringify({
      event: 'end',
      endSessionId: sessionId,
      timestamp: Date.now(),
    }))
    if (id === null) throw new Error('gateway end xadd returned null')
  }

  private async getStreamTip(responseStream: string): Promise<string> {
    return this.bus.streamTip(responseStream)
  }

  private async publishRequest(
    requestStream: string,
    sessionId: string,
    input: TInput,
    userContext?: UserContext,
  ): Promise<void> {
    // userContext는 **서버가 정하는 값**이다. LLM 도구 입력에 실려 온 동명 필드를
    // 그대로 흘리면 에이전트의 resolveWorkspaceRoot가 그 값을 설정보다 우선해
    // 모델이 자기 워크스페이스를 고르게 된다. 도구 inputSchema에는
    // additionalProperties:false가 없고 이 경로에 Zod 검증도 없으므로 여기서 벗겨낸다.
    //
    // userContext가 undefined인 경로가 실재한다 — Manager 자신이 watcher
    // file_changed로 발행하는 task_request에는 userContext가 없다.
    const { userContext: _injected, ...safeInput } = (input ?? {}) as Record<string, unknown>
    void _injected
    const payload = userContext !== undefined
      ? { ...safeInput, userContext }
      : safeInput
    await this.bus.publish(requestStream, {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: this.requestType,
      payload,
    })
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
    if (msg.type === 'agent_query') {
      throw new AgentQueryError(
        String(msg.payload['to'] ?? ''),
        String(msg.payload['question'] ?? ''),
        msg.payload['kind'] === 'cross_check' ? 'cross_check' : 'active_request',
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

  /**
   * §13 벌크헤드 게이트. 주입 시 agentName 키로 동시 RPC를 캡(초과 시 큐잉·백프레셔)한 뒤 실 RPC 실행.
   * 미주입이면 직접 실행(회귀 0). 한 종류의 에이전트 폭주가 다른 종류의 풀을 잠식하지 않게 격리.
   */
  async execute(input: TInput, sessionId: string, userContext?: UserContext): Promise<TOutput> {
    if (!this.bulkhead) return this.executeRpc(input, sessionId, userContext)
    return this.bulkhead.run(this.agentName, () => this.executeRpc(input, sessionId, userContext))
  }

  private async executeRpc(input: TInput, sessionId: string, userContext?: UserContext): Promise<TOutput> {
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

      const results = await this.bus.readFrom(responseStream, lastId, { count: 10, blockMs })

      if (!results) continue

      const { lastId: updatedId, output } = this.processStreamResults(results, lastId)
      lastId = updatedId
      if (output !== null) return output
    }

    // 타임아웃은 "그 세션 소비자가 사라졌을 수 있다"는 유일한 신호다. memo를 풀어 다음
    // RPC가 게이트웨이를 재통지하게 한다 — 에이전트 단독 재시작·종료 통지 유실의 공통 백스톱.
    // 이것이 없으면 에이전트가 재시작된 순간 그 세션은 그 에이전트에 대해 영구히 죽는다.
    this._notifiedSessions.delete(notifyKey)
    throw new Error(`${this.agentName} timed out after ${this.timeoutMs}ms`)
  }

  /**
   * 세션 종료. 게이트웨이에 종료를 알려 **에이전트 쪽 세션 소비자를 내린다** —
   * 알리지 않으면 그 소비자와 전용 Redis 연결이 프로세스 수명 내내 남는다.
   *
   * never-throw다(저장소 관례). 발행이 실패하면 소비자가 안 내려가 자원만 새고,
   * 세션 정리 자체는 계속 진행된다(fail-open).
   *
   * ①발행 → ②memo 삭제 **순서가 계약이다.** 뒤집으면 발행 대기 중 도착한 새 RPC가
   * 재통지(start)를 먼저 실어 end가 그 뒤에 놓이고, 방금 연 소비자가 즉시 내려간다.
   */
  async releaseSession(sessionId: string): Promise<void> {
    const notifyKey = `${this.agentName}:${sessionId}`
    if (!this._notifiedSessions.has(notifyKey)) return
    try {
      await this.endGateway(sessionId)
    } catch (err) {
      console.error(`[RedisAgentHandler] ${this.agentName} 세션 종료 통지 실패(무시):`, err)
    } finally {
      this._notifiedSessions.delete(notifyKey)
    }
  }

  async close(): Promise<void> {
    // _redis is a cached client from getRedisClient; do not quit it here.
    // Lifecycle is managed by closeRedisClients() at process shutdown.
    this._redis = null
    this._bus = null // _redis와 동기 리셋 — stale 래퍼 방지(다음 사용 시 현재 클라이언트로 재생성)
    this._notifiedSessions.clear()
  }
}
