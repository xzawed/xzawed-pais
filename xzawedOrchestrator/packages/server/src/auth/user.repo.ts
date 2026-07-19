import type { Pool } from 'pg'

export interface User {
  id: string
  email: string
  passwordHash: string
  displayName: string | null
  /** G11 Slice 1: 소속 테넌트(사용자당 단일 org·모델 C). 백필 후 non-null. */
  orgId: string | null
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
  org_id: string | null
  created_at: Date
  updated_at: Date
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    orgId: row.org_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class UserRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * G11 Slice 1: 가입 시 개인 org를 자동 생성하고 user에 연결한다(모델 C·사용자당 단일 org).
   * org 생성과 user INSERT를 단일 트랜잭션으로 묶어 원자성 보장(org만 남는 고아 방지).
   */
  async create(email: string, passwordHash: string, displayName?: string): Promise<User> {
    const normEmail = email.toLowerCase()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: orgRows } = await client.query<{ id: string }>(
        'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
        [`${normEmail} workspace`]
      )
      const orgId = orgRows[0]?.id ?? null
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (email, password_hash, display_name, org_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [normEmail, passwordHash, displayName ?? null, orgId]
      )
      await client.query('COMMIT')
      const row = rows[0]
      if (!row) throw new Error('Failed to create user')
      return rowToUser(row)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
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
