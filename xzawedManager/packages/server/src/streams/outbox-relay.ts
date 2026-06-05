import type { Pool } from 'pg'

interface PublisherLike {
  publishRaw(stream: string, message: unknown): Promise<void>
}
interface OutboxRow {
  id: number
  stream: string
  message: unknown
}

/** manager_outbox의 미발행 이벤트를 Redis로 발행하는 폴링 릴레이(at-least-once). */
export class OutboxRelay {
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false

  constructor(
    private readonly pool: Pool,
    private readonly producer: PublisherLike,
    private readonly pollMs = 500,
    private readonly batch = 50,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.pollOnce()
    }, this.pollMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * 미발행 row 1배치를 발행한다. 발행 실패한 row는 pending 유지(attempts++).
   * 재진입 가드: 느린 발행으로 setInterval 틱이 겹쳐도 동시 pollOnce를 막아 동일 row 이중 발행을 차단한다(단일 릴레이 전제).
   * (다중 릴레이 동시 클레임 — tx 내 FOR UPDATE SKIP LOCKED·published_at 선점 — 은 P1 멱등 소비와 함께.)
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const { rows } = await this.pool.query(
        `SELECT id, stream, message FROM manager_outbox
         WHERE published_at IS NULL ORDER BY id LIMIT $1`,
        [this.batch],
      )
      for (const row of rows as OutboxRow[]) {
        try {
          await this.producer.publishRaw(row.stream, row.message)
          await this.pool.query(`UPDATE manager_outbox SET published_at = NOW() WHERE id = $1`, [row.id])
        } catch (err) {
          await this.pool.query(`UPDATE manager_outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id])
          console.warn('[outbox-relay] 발행 실패 — pending 유지:', err)
        }
      }
    } finally {
      this.polling = false
    }
  }
}
