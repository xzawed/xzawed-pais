import { Pool } from 'pg'
import { readFile, readdir } from 'node:fs/promises'
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
  // 디렉터리의 모든 .sql을 번호 prefix(001_, 002_, …) 사전순으로 적용 — 새 마이그레이션 추가 시 자동 반영(목록 누락 방지)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf-8')
    await p.query(sql)
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
