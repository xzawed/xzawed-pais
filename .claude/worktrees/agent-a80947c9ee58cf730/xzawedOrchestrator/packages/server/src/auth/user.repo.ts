import type { Pool } from 'pg'

export interface User {
  id: string
  email: string
  passwordHash: string
  displayName: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UserPublic {
  id: string
  email: string
  displayName: string | null
  createdAt: Date
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  display_name: string | null
  created_at: Date
  updated_at: Date
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class UserRepo {
  constructor(private readonly pool: Pool) {}

  async create(email: string, passwordHash: string, displayName?: string): Promise<User> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email.toLowerCase(), passwordHash, displayName ?? null]
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create user')
    return rowToUser(row)
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    )
    const row = rows[0]
    return row ? rowToUser(row) : undefined
  }

  async findById(id: string): Promise<User | undefined> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    )
    const row = rows[0]
    return row ? rowToUser(row) : undefined
  }
}

export function toPublic(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  }
}
