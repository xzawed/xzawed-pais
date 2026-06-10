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

// pg advisory lock 키(임의 고정값) — 동시 runMigrations 직렬화 식별자.
const MIGRATION_LOCK_KEY = 729_431

export async function runMigrations(p: Pool): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  // 디렉터리의 모든 .sql을 번호 prefix(001_, 002_, …) 사전순으로 적용 — 새 마이그레이션 추가 시 자동 반영(목록 누락 방지)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  // 동시 실행 직렬화(advisory lock): CREATE TABLE IF NOT EXISTS도 병렬이면 pg 카탈로그 경합
  // (duplicate key pg_type 등)으로 실패할 수 있다 — 다중 인스턴스 기동·병렬 통합 테스트 공통 방어.
  // 락은 세션 소유라 같은 client로 잡고 풀어야 한다(pool.query는 매번 다른 연결).
  const client = await p.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      for (const file of files) {
        const sql = await readFile(join(migrationsDir, file), 'utf-8')
        await client.query(sql)
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
