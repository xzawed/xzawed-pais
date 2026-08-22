import type { Redis } from 'ioredis'
import { z } from 'zod'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

/**
 * 게이트웨이 엔트리 계약.
 *
 * 시작은 기존 형태를 **한 글자도 바꾸지 않는다**. 종료는 `sessionId` 키를 쓰지 않고
 * `endSessionId`를 쓴다 — 이것이 전방호환 장치다. 구 디스패처는 `parsed.sessionId`가
 * 문자열인지만 보고 세션을 띄우므로, 종료 통지에 `sessionId`가 실려 있으면 그것을
 * 시작으로 오독해 **이미 끝난 세션의 소비자를 부활**시킨다. 키 이름을 바꾸면 구 코드는
 * 그 엔트리를 인식하지 못하고 조용히 지나간다(이미 ack된 상태라 잔류도 없다).
 *
 * 발행측 정본은 Manager `tools/redis-agent-handler.ts`다. 두 서비스가 이 스키마를
 * 공유하도록 배럴로 export한다.
 */
export const GatewayStartSchema = z.object({
  sessionId: z.string().min(1),
  timestamp: z.number().optional(),
})

export const GatewayEndSchema = z.object({
  event: z.literal('end'),
  endSessionId: z.string().min(1),
  timestamp: z.number().optional(),
})

export interface ConsumerLike {
  start(sessionId: string): Promise<void>
  stop(): void
  close?(): Promise<void>
}

export class SessionDispatcher {
  private running = false
  private readonly activeConsumers = new Map<string, ConsumerLike>()
  /**
   * stop()은 걸었지만 아직 루프를 빠져나오지 못한 소비자. cap 정직성을 위해 센다 —
   * 정지 중인 것을 세지 않으면 실제 자원보다 적게 집계해 cap이 무의미해진다.
   */
  private readonly stoppingConsumers = new Set<ConsumerLike>()
  private readonly MAX_ACTIVE_CONSUMERS = 1000

  constructor(
    private readonly gatewayRedis: Redis,
    private readonly gatewayStream: string,
    private readonly group: string,
    private readonly consumerFactory: (sessionId: string) => ConsumerLike,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise(r => setTimeout(r, ms)),
  ) {}

  async start(): Promise<void> {
    try {
      await this.gatewayRedis.xgroup('CREATE', this.gatewayStream, this.group, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    const consumerId = `${this.group}-${process.pid}`
    let retryDelay = INITIAL_RETRY_DELAY_MS

    while (this.running) {
      try {
        const results = await this.gatewayRedis.xreadgroup(
          'GROUP', this.group, consumerId,
          'COUNT', '10', 'BLOCK', '2000',
          'STREAMS', this.gatewayStream, '>',
        ) as [string, [string, string[]][]][] | null

        if (!results) {
          retryDelay = INITIAL_RETRY_DELAY_MS
          // yield to event loop so stop() can be observed between iterations
          await this.sleep(0)
          continue
        }

        for (const [, entries] of results) {
          for (const [msgId, fields] of entries) {
            try {
              this.handleGatewayEntry(fields)
            } catch (err) {
              console.error('[SessionDispatcher] entry error:', err)
            } finally {
              await this.gatewayRedis.xack(this.gatewayStream, this.group, msgId)
            }
          }
        }
        retryDelay = INITIAL_RETRY_DELAY_MS
      } catch (err: unknown) {
        if (!this.running) break
        console.error(`[SessionDispatcher] xreadgroup error, retrying in ${retryDelay}ms:`, err)
        await this.sleep(retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
      }
    }
  }

  /** 무음 return을 남기지 않는다 — 여기서 사라진 엔트리는 DLQ에도 안 남기 때문이다(M8). */
  private handleGatewayEntry(fields: string[]): void {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) { console.error('[SessionDispatcher] data 필드 없음 — skip'); return }
    const raw = fields[dataIdx + 1]
    if (raw === undefined) { console.error('[SessionDispatcher] data 값 없음 — skip'); return }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('[SessionDispatcher] JSON 무효 — skip')
      return
    }

    const end = GatewayEndSchema.safeParse(parsed)
    if (end.success) { this.endSession(end.data.endSessionId); return }

    const start = GatewayStartSchema.safeParse(parsed)
    if (!start.success) { console.error('[SessionDispatcher] 미지 게이트웨이 엔트리 — skip'); return }

    void this.handleSessionEntry(start.data.sessionId)
  }

  /**
   * 세션 종료 수신. Map에서 **즉시** 빼는 것이 핵심이다 — 정지 완료를 기다렸다가 빼면
   * 그 사이 도착한 재개통 요청이 tombstone에 막힌다. 정지·close는 백그라운드로 돌린다.
   */
  private endSession(sessionId: string): void {
    const consumer = this.activeConsumers.get(sessionId)
    if (!consumer) {
      console.warn(`[SessionDispatcher] end for unknown session ${sessionId} — no-op`)
      return
    }
    this.activeConsumers.delete(sessionId)
    this.stoppingConsumers.add(consumer)
    consumer.stop()
    void this.closeQuiet(consumer)
  }

  /** close 실패가 디스패처를 죽이지 않는다 — 자원만 새고 라우팅은 계속한다(fail-open). */
  private async closeQuiet(consumer: ConsumerLike): Promise<void> {
    try {
      await consumer.close?.()
    } catch (err) {
      console.error('[SessionDispatcher] consumer close 실패:', err)
    }
  }

  private async handleSessionEntry(sessionId: string): Promise<void> {
    if (this.activeConsumers.has(sessionId)) return

    if (this.activeConsumers.size + this.stoppingConsumers.size >= this.MAX_ACTIVE_CONSUMERS) {
      console.error(`[SessionDispatcher] max consumers (${this.MAX_ACTIVE_CONSUMERS}) reached, ignoring session ${sessionId}`)
      return
    }

    // try 밖 선언 — finally에서 참조해야 하고(자원 회수), 팩토리 throw도 구분해야 한다.
    let consumer: ConsumerLike | undefined
    try {
      consumer = this.consumerFactory(sessionId)
      this.activeConsumers.set(sessionId, consumer)
      await consumer.start(sessionId)
    } catch (err: unknown) {
      console.error(`[SessionDispatcher] consumer error for ${sessionId}:`, err)
    } finally {
      if (consumer !== undefined) {
        // identity 확인 — end 후 재개통된 '새' 소비자를 옛 소비자의 종료가 지우면 안 된다.
        if (this.activeConsumers.get(sessionId) === consumer) this.activeConsumers.delete(sessionId)
        this.stoppingConsumers.delete(consumer)
        await this.closeQuiet(consumer)
      }
    }
  }

  stop(): void {
    this.running = false
    for (const consumer of this.activeConsumers.values()) {
      consumer.stop()
      void this.closeQuiet(consumer)
    }
    this.activeConsumers.clear()
  }

  async close(): Promise<void> {
    this.running = false
    const closePromises: Promise<void>[] = []
    for (const consumer of this.activeConsumers.values()) {
      consumer.stop()
      closePromises.push(this.closeQuiet(consumer))
    }
    this.activeConsumers.clear()
    await Promise.all(closePromises)
  }
}
