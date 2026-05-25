import { Pool } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
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

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function runMigrations(p: Pool): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  await runMigrationsFromDir(p, migrationsDir)
}

export async function runMigrationsFromDir(p: Pool, migrationsDir: string): Promise<void> {
  // Acquire advisory lock to prevent concurrent migrations across multiple instances.
  // Lock key is a deterministic integer derived from the app name.
  const LOCK_KEY = 7237961  // crc32('xzawed-orchestrator') truncated

  const client = await p.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    INTEGER PRIMARY KEY,
          name       TEXT    NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)

      const { rows } = await client.query<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version'
      )
      const applied = new Set(rows.map(r => r.version))

      const files = (await readdir(migrationsDir))
        .filter(f => /^\d{3}_.*\.sql$/.test(f))
        .sort()

      for (const file of files) {
        const version = Number.parseInt(file.slice(0, 3), 10)
        if (applied.has(version)) continue

        const sql = await readFile(join(migrationsDir, file), 'utf-8')
        await client.query('BEGIN')
        try {
          await client.query(sql)
          await client.query(
            'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
            [version, file]
          )
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
    }
  } finally {
    client.release()
  }
}
