import type { Pool } from 'pg'
import type { SessionState } from '../sessions/session.store.js'

export class SessionRepo {
  constructor(private readonly pool: Pool) {}

  async insert(sessionId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (session_id, state) VALUES ($1, 'idle') ON CONFLICT DO NOTHING`,
      [sessionId],
    )
  }

  async updateState(sessionId: string, state: SessionState): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET state = $1, updated_at = NOW() WHERE session_id = $2`,
      [state, sessionId],
    )
  }

  async remove(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE session_id = $1`, [sessionId])
  }
}
