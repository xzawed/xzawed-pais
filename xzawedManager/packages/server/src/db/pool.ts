import { Pool } from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { isMigrationFile, parseMigrationVersion } from './migration-guard.js'

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
// 각 마이그레이션은 BEGIN..COMMIT 한 트랜잭션이라 데드락 시 버전 기록까지 함께 롤백되고,
// 재시도가 BEGIN부터 다시 돌아 부분 적용이 남지 않는다 → 짧은 백오프로 CI 데드락 flake를 흡수한다.
const RETRYABLE_MIGRATION_CODES = new Set(['40P01', '40001']) // deadlock_detected · serialization_failure
const MAX_MIGRATION_ATTEMPTS = 5

/**
 * 데드락·직렬화 실패로 중단된 **트랜잭션 전체**를 백오프 후 재실행한다.
 *
 * 40P01은 pg가 트랜잭션을 이미 중단시킨 상태라 부분 커밋이 남지 않는다 — 즉 몸체를
 * 처음부터 다시 돌려도 안전하다. 단, 감싸는 함수가 자체 멱등이어야 한다(BEGIN부터
 * 재시작하고 외부 부수효과가 없어야 한다).
 *
 * 적용 기준은 "관측된 victim"이다. 추정으로 전파하지 않는다 — 띄우면 실패가
 * 사라지는 게 아니라 느려지기만 하는 경로가 생길 수 있다.
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
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

/**
 * 적용 기록 테이블. 모델은 Orchestrator(`db/pool.ts`)와 같지만 **이름은 반드시 다르다.**
 *
 * 런타임에 두 서비스가 같은 DB 를 쓴다(`docker-compose.yml:83` — Manager 의 `DATABASE_URL` 이
 * `xzawed_orchestrator` 를 가리킨다). Orchestrator 가 이미 `schema_migrations` 에 자기 버전
 * 1~8 을 기록하므로, 접두사 없는 이름을 쓰면 **버전 번호가 서로를 덮는다** — Manager 가 자기
 * `001`~`008` 을 "적용됨"으로 오인해 조용히 건너뛰고, 반대로 Manager 가 먼저 뜨면 Orchestrator 가
 * `users`·`sessions` 를 만들지 않은 채 성공을 반환한다. 둘 다 예외 없이 통과하는 무음 실패다.
 *
 * Manager 의 다른 테이블이 전부 `manager_` 접두사(`manager_sessions`·`manager_events`·
 * `manager_outbox`)인 것과 같은 이유이고, 설계 문서의 C1(런타임 공유·CI 분리)이 그 전제다.
 */
const TRACKING_TABLE = 'manager_schema_migrations'
const TRACKING_DDL = `
  CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

/**
 * 번호 prefix(`001_`, `002_`, …) 사전순으로, **아직 적용되지 않은 것만** 적용한다.
 *
 * S3.4 이전에는 추적 테이블이 없어 매 기동마다 전량 재실행했다. 그 모델에서는 모든 DDL 이
 * 멱등이어야 했고, `ADD CONSTRAINT`(Postgres 에 `IF NOT EXISTS` 문법이 없다)를 쓰는 순간
 * **두 번째 기동에서 서버가 죽었다** — 테스트는 무DB 정적 검사라 그린인 채로.
 *
 * **기존 DB 의 베이스라인.** 추적 테이블이 없던 DB 가 이 러너로 처음 뜨면 기록이 비어 있어
 * 전 마이그레이션이 한 번 더 돈다. 그 한 번이 안전한 이유는 기존 파일이 전부 멱등이기
 * 때문이고, `migration-guard.ts` 가 그 불변식을 소스에서 계속 강제한다.
 */
export async function runMigrations(p: Pool): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  // 파일명 규약은 `migration-guard.ts` 가 단일 출처다 — 러너와 전수 스캔 테스트가 갈리면
  // 러너가 무시하는 파일을 스캔도 못 보는 이중 사각지대가 생긴다.
  const files = (await readdir(migrationsDir))
    .filter(isMigrationFile)
    .sort((a, b) => (parseMigrationVersion(a)! - parseMigrationVersion(b)!))
  // 동시 실행 직렬화(advisory lock): CREATE TABLE IF NOT EXISTS도 병렬이면 pg 카탈로그 경합
  // (duplicate key pg_type 등)으로 실패할 수 있다 — 다중 인스턴스 기동·병렬 통합 테스트 공통 방어.
  // 락은 세션 소유라 같은 client로 잡고 풀어야 한다(pool.query는 매번 다른 연결).
  const client = await p.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      await client.query(TRACKING_DDL)
      const { rows } = await client.query<{ version: number }>(
        `SELECT version FROM ${TRACKING_TABLE} ORDER BY version`,
      )
      const applied = new Set(rows.map((r) => Number(r.version)))

      for (const file of files) {
        const version = parseMigrationVersion(file)!
        if (applied.has(version)) continue
        const sql = await readFile(join(migrationsDir, file), 'utf-8')
        // 재시도는 **트랜잭션 전체**를 다시 돈다. 40P01 은 pg 가 트랜잭션을 이미 abort 시킨
        // 상태라 그 안에서 단일 문만 재실행하는 것은 성립하지 않는다(25P02 로 이어진다).
        await withDeadlockRetry(async () => {
          await client.query('BEGIN')
          try {
            await client.query(sql)
            await client.query(`INSERT INTO ${TRACKING_TABLE} (version, name) VALUES ($1, $2)`, [version, file])
            await client.query('COMMIT')
          } catch (err) {
            try {
              await client.query('ROLLBACK')
            } catch (rollbackErr) {
              // 롤백까지 실패하면 세션이 aborted 트랜잭션에 갇힌다. 그 상태로 재시도하면
              // BEGIN 이 25P02 를 내고 원 실패(40P01)를 잃는다 — 재시도 코드를 떼어내
              // 즉시 포기시키되, 두 실패를 모두 메시지에 남긴다.
              throw new Error(
                `마이그레이션 ${file} 실패 후 ROLLBACK 도 실패 — 연결이 aborted 상태다. ` +
                `원 실패: ${(err as Error).message} / ROLLBACK: ${(rollbackErr as Error).message}`,
              )
            }
            throw err
          }
        })
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
