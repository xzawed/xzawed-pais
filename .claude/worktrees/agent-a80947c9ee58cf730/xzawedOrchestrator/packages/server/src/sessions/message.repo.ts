import type { Pool } from 'pg'
import type { Message, MessageRole } from '@xzawed/shared'

interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string
  created_at: Date
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    timestamp: row.created_at.getTime(),
  }
}

export class MessageRepo {
  constructor(private readonly pool: Pool) {}

  async findBySession(sessionId: string): Promise<Message[]> {
    const { rows } = await this.pool.query<MessageRow>(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    )
    return rows.map(rowToMessage)
  }

  async create(sessionId: string, role: MessageRole, content: string): Promise<Message> {
    const { rows } = await this.pool.query<MessageRow>(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3) RETURNING *',
      [sessionId, role, content]
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create message')
    return rowToMessage(row)
  }
}
