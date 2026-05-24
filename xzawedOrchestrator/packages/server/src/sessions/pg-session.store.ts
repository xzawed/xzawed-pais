import type { Pool } from 'pg'
import type { Session, SessionState, ClaudeMode } from '@xzawed/shared'
import type { SessionStore } from './session.store.js'

interface SessionRow {
  id: string
  user_id: string
  project_id: string
  claude_mode: string
  claude_session_id: string | null
  state: string
  created_at: Date
  updated_at: Date
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    state: row.state as SessionState,
    claudeMode: row.claude_mode as ClaudeMode,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  }
}

export class PgSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, projectId: string | null, claudeMode: ClaudeMode): Promise<Session> {
    if (!projectId) throw new Error('projectId is required')
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (user_id, project_id, claude_mode)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, projectId, claudeMode]
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create session')
    return rowToSession(row)
  }

  async findById(id: string): Promise<Session | undefined> {
    const { rows } = await this.pool.query<SessionRow>(
      'SELECT * FROM sessions WHERE id = $1',
      [id]
    )
    const row = rows[0]
    return row ? rowToSession(row) : undefined
  }

  async updateState(id: string, state: SessionState): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET state = $2, updated_at = NOW() WHERE id = $1',
      [id, state]
    )
  }

  async updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET claude_session_id = $2, updated_at = NOW() WHERE id = $1',
      [id, claudeSessionId]
    )
  }

  async updateProject(id: string, projectId: string): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET project_id = $2, updated_at = NOW() WHERE id = $1',
      [id, projectId]
    )
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id])
  }
}
