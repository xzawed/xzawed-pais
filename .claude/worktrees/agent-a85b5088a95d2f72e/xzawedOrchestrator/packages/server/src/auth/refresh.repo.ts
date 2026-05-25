import type { Pool } from 'pg'
import { createHash } from 'node:crypto'

export class RefreshRepo {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, expiresAt, userAgent ?? null]
    )
  }

  async findValid(token: string): Promise<{ id: string; userId: string } | undefined> {
    const hash = createHash('sha256').update(token).digest('hex')
    const { rows } = await this.pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = $1
         AND expires_at > NOW()
         AND revoked_at IS NULL`,
      [hash]
    )
    const row = rows[0]
    return row ? { id: row.id, userId: row.user_id } : undefined
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [id]
    )
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    )
  }
}
