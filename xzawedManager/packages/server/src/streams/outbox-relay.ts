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

  /** 미발행 row 1배치를 발행한다. 발행 실패한 row는 pending 유지(attempts++). */
  async pollOnce(): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT id, stream, message FROM manager_outbox
       WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
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
  }
}
