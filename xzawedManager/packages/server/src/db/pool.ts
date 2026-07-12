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

// 공유 테스트 DB에서 마이그레이션 DDL(CREATE INDEX=ShareLock·ALTER TABLE=AccessExclusiveLock)이
// 다른 파일의 동시 DML(RowExclusiveLock)과 반대 순서로 락을 잡으면 pg가 한쪽을 데드락 victim으로
// abort한다(40P01). advisory lock은 migration↔migration만 직렬화하고 migration↔DML은 못 막으며,
// CI에서 관측된 victim은 runMigrations 자신이었다(oracle-approval beforeAll·rare·로컬 재현 불가).
// 각 마이그레이션 파일은 단일 암묵 트랜잭션이라 데드락 시 전체 롤백되고, 전부 IF NOT EXISTS로
// 멱등이라 재적용이 안전하다 → 짧은 백오프로 재시도해 CI 데드락 flake를 흡수한다(정상 경로 회귀 0).
const RETRYABLE_MIGRATION_CODES = new Set(['40P01', '40001']) // deadlock_detected · serialization_failure
const MAX_MIGRATION_ATTEMPTS = 5

interface MigrationClient {
  query(sql: string): Promise<unknown>
}

// 단일 마이그레이션 파일을 적용하되, 일시적 락 경합(데드락/직렬화 실패)이면 백오프 후 재시도한다.
// sleep은 테스트 주입용(기본은 실 setTimeout).
export async function applyMigration(
  client: MigrationClient,
  sql: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.query(sql)
      return
    } catch (err) {
      const code = (err as { code?: unknown }).code
      if (typeof code === 'string' && RETRYABLE_MIGRATION_CODES.has(code) && attempt < MAX_MIGRATION_ATTEMPTS) {
        await sleep(50 * attempt)
        continue
      }
      throw err
    }
  }
}

export async function runMigrations(p: Pool): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  // 디렉터리의 모든 .sql을 번호 prefix(001_, 002_, …) 사전순으로 적용 — 새 마이그레이션 추가 시 자동 반영(목록 누락 방지)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b))
  // 동시 실행 직렬화(advisory lock): CREATE TABLE IF NOT EXISTS도 병렬이면 pg 카탈로그 경합
  // (duplicate key pg_type 등)으로 실패할 수 있다 — 다중 인스턴스 기동·병렬 통합 테스트 공통 방어.
  // 락은 세션 소유라 같은 client로 잡고 풀어야 한다(pool.query는 매번 다른 연결).
  const client = await p.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      for (const file of files) {
        const sql = await readFile(join(migrationsDir, file), 'utf-8')
        await applyMigration(client, sql)
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
