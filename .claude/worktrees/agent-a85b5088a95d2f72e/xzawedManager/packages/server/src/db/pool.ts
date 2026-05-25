import { Pool } from 'pg'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

let pool: Pool | null = null

export function createPool(connectionString: string): Pool {
  pool = new Pool({ connectionString })
  return pool
}

export function getPool(): Pool | null {
  return pool
}

export async function runMigrations(p: Pool): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  const sql = await readFile(join(migrationsDir, '001_sessions.sql'), 'utf-8')
  await p.query(sql)
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
