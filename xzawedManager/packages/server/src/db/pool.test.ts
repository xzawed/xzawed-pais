import { describe, test, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { runMigrations, withDeadlockRetry } from './pool.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** runMigrations는 전용 client(advisory lock 직렬화)로 실행 — connect/release까지 mock. */
function mockPool() {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { pool: { connect } as unknown as Pool, query, release, connect }
}

describe('runMigrations', () => {
  test('advisory lock 안에서 미적용 .sql을 파일명 정렬 순으로 적용하고 unlock·release한다', async () => {
    const expected = (await readdir(migrationsDir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
    const { pool, query, release } = mockPool()

    await runMigrations(pool)

    // S3.4 이후 호출 구조: [advisory_lock, schema_migrations DDL, SELECT version,
    //                      ...(BEGIN, sql, INSERT, COMMIT) × 파일수, advisory_unlock]
    // 고정 mock 은 SELECT 에 빈 rows 를 주므로 전 파일이 미적용으로 취급된다.
    expect(String(query.mock.calls[0]![0])).toMatch(/pg_advisory_lock/)
    expect(String(query.mock.calls.at(-1)![0])).toMatch(/pg_advisory_unlock/)

    const bodies = query.mock.calls.map((c) => String(c[0]))
    // 파일 본문이 사전 정렬 순으로, 각자 BEGIN 직후에 나타난다.
    const appliedInOrder: string[] = []
    for (let i = 0; i < bodies.length; i++) {
      if (/^BEGIN$/i.test(bodies[i]!.trim())) appliedInOrder.push(bodies[i + 1]!)
    }
    expect(appliedInOrder).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(appliedInOrder[i]).toBe(await readFile(join(migrationsDir, expected[i]!), 'utf-8'))
    }
    expect(release).toHaveBeenCalledTimes(1)
  })

  test('approver 컬럼 마이그레이션(004)을 적용한다', async () => {
    const { pool, query } = mockPool()

    await runMigrations(pool)

    const applied = query.mock.calls.map((c) => c[0] as string)
    expect(applied.some((sql) => /ADD COLUMN IF NOT EXISTS approver/i.test(sql))).toBe(true)
  })

  test('마이그레이션 SQL 실패 시에도 unlock·release를 보장한다', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // advisory_lock
      .mockRejectedValueOnce(new Error('migration boom')) // schema_migrations DDL 실패
      .mockResolvedValue({ rows: [] }) // ROLLBACK·advisory_unlock
    const release = vi.fn()
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool

    await expect(runMigrations(pool)).rejects.toThrow(/migration boom/)
    expect(String(query.mock.calls.at(-1)![0])).toMatch(/pg_advisory_unlock/)
    expect(release).toHaveBeenCalledTimes(1)
  })
})

/**
 * S3.4 버전 추적 — `schema_migrations` 로 적용분을 건너뛴다.
 *
 * 수용 기준 L2-9 는 "마이그레이션이 2회 연속 기동에서 동일 결과를 낸다"이고, 그것을 여기서
 * 상태 있는 가짜 client 로 실증한다(무DB·hermetic). 적용 기록이 실제로 소비되는지를 봐야
 * 하므로 `{ rows: [] }` 고정 mock 으로는 위음성이다.
 */
function statefulClient(preApplied: number[] = []) {
  const applied = new Set(preApplied)
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/SELECT\s+version\s+FROM\s+\w*schema_migrations/i.test(sql)) {
      return { rows: [...applied].sort((a, b) => a - b).map((version) => ({ version })) }
    }
    if (/INSERT\s+INTO\s+\w*schema_migrations/i.test(sql)) {
      applied.add(params![0] as number)
    }
    return { rows: [] }
  })
  const release = vi.fn()
  // 매 기동이 새 connect 를 하지만 DB 상태(applied)는 공유된다 — 실제 재기동과 같은 구조.
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool
  return { pool, query, release, applied }
}

/** 마이그레이션 파일 SQL 로 실행된 query 만 골라낸다(락·추적 SQL 제외). */
async function appliedMigrationSql(query: ReturnType<typeof vi.fn>): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
  const bodies = new Set<string>()
  for (const f of files) bodies.add(await readFile(join(migrationsDir, f), 'utf-8'))
  return query.mock.calls.map((c) => c[0] as string).filter((sql) => bodies.has(sql))
}

describe('runMigrations — 버전 추적(S3.4)', () => {
  test('추적 테이블을 만들고 적용 버전을 조회한다', async () => {
    const { pool, query } = statefulClient()

    await runMigrations(pool)

    const sqls = query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => /CREATE TABLE IF NOT EXISTS manager_schema_migrations/i.test(s))).toBe(true)
    expect(sqls.some((s) => /SELECT version FROM manager_schema_migrations/i.test(s))).toBe(true)
  })

  /**
   * **런타임에 Orchestrator 와 같은 DB 를 쓴다**(`docker-compose.yml:83` — Manager 의
   * `DATABASE_URL` 이 `xzawed_orchestrator` 를 가리킨다). Orchestrator 는 이미 자기
   * `schema_migrations` 에 버전 1~8 을 기록하므로, 접두사 없는 이름을 쓰면 Manager 가
   * 자기 `001`~`008` 을 "적용됨"으로 오인해 **조용히 건너뛴다.** Manager 의 다른 테이블이
   * 전부 `manager_` 접두사인 것과 같은 이유다.
   */
  test('추적 테이블 이름이 Orchestrator 와 충돌하지 않는다(manager_ 접두사)', async () => {
    const { pool, query } = statefulClient()

    await runMigrations(pool)

    const sqls = query.mock.calls.map((c) => String(c[0]))
    const touchesTracking = sqls.filter((s) => /schema_migrations/i.test(s))
    expect(touchesTracking.length).toBeGreaterThan(0)
    // 접두사 없는 schema_migrations 를 건드리는 문장이 하나도 없어야 한다.
    for (const s of touchesTracking) {
      expect(s, `Orchestrator 소유 테이블을 건드린다: ${s.slice(0, 80)}`)
        .not.toMatch(/(?<!manager_)\bschema_migrations\b/i)
    }
  })

  test('첫 기동은 전 마이그레이션을 적용하고 버전을 기록한다', async () => {
    const files = (await readdir(migrationsDir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
    const { pool, query, applied } = statefulClient()

    await runMigrations(pool)

    expect(await appliedMigrationSql(query)).toHaveLength(files.length)
    expect(applied.size).toBe(files.length)
    expect(applied.has(1)).toBe(true)
    expect(applied.has(files.length)).toBe(true)
  })

  test('2회 연속 기동에서 두 번째는 마이그레이션을 0건 적용한다(L2-9)', async () => {
    const { pool, query } = statefulClient()

    await runMigrations(pool)
    const firstBoot = (await appliedMigrationSql(query)).length
    query.mockClear()
    await runMigrations(pool)

    expect(firstBoot).toBeGreaterThan(0)
    expect(await appliedMigrationSql(query)).toEqual([])
  })

  test('미적용 버전만 골라 적용한다', async () => {
    const files = (await readdir(migrationsDir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
    const last = files.length
    // 마지막 하나만 미적용인 상태로 기동.
    const { pool, query } = statefulClient([...Array(last - 1)].map((_, i) => i + 1))

    await runMigrations(pool)

    const ran = await appliedMigrationSql(query)
    expect(ran).toHaveLength(1)
    expect(ran[0]).toBe(await readFile(join(migrationsDir, files[last - 1]!), 'utf-8'))
  })

  test('마이그레이션과 버전 기록은 한 트랜잭션이다(실패 시 기록 없음)', async () => {
    const { pool, query } = statefulClient()

    await runMigrations(pool)

    const sqls = query.mock.calls.map((c) => String(c[0]))
    expect(sqls.filter((s) => /^BEGIN$/i.test(s.trim())).length).toBeGreaterThan(0)
    expect(sqls.filter((s) => /^COMMIT$/i.test(s.trim())).length).toBeGreaterThan(0)
    // BEGIN 과 COMMIT 은 짝이 맞아야 한다.
    expect(sqls.filter((s) => /^BEGIN$/i.test(s.trim())).length)
      .toBe(sqls.filter((s) => /^COMMIT$/i.test(s.trim())).length)
  })

  test('마이그레이션 실패 시 ROLLBACK 하고 버전을 기록하지 않는다', async () => {
    const applied = new Set<number>()
    let sawRollback = false
    // 제어문(락·추적·트랜잭션) 외의 첫 SQL = 첫 마이그레이션 본문에서 터뜨린다.
    // 특정 테이블명에 걸면 파일이 바뀔 때 조용히 위음성이 된다(실제로 한 번 그랬다).
    const isControl = (sql: string): boolean =>
      /pg_advisory_(un)?lock|schema_migrations|^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (/SELECT\s+version\s+FROM\s+\w*schema_migrations/i.test(sql)) return { rows: [] }
      if (/INSERT\s+INTO\s+\w*schema_migrations/i.test(sql)) { applied.add(params![0] as number); return { rows: [] } }
      if (/^ROLLBACK$/i.test(sql.trim())) { sawRollback = true; return { rows: [] } }
      if (!isControl(sql)) throw new Error('migration boom')
      return { rows: [] }
    })
    const release = vi.fn()
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool

    await expect(runMigrations(pool)).rejects.toThrow(/migration boom/)
    expect(sawRollback).toBe(true)
    expect(applied.size).toBe(0)
    expect(String(query.mock.calls.at(-1)![0])).toMatch(/pg_advisory_unlock/)
    expect(release).toHaveBeenCalledTimes(1)
  })

  /**
   * ROLLBACK 이 실패하면 세션은 **aborted transaction** 에 갇힌다. 그 상태에서 재시도가
   * `BEGIN` 을 던지면 25P02(`current transaction is aborted`)가 나고, 그것은 재시도 대상이
   * 아니라 원래의 40P01 을 잃은 채 죽는다. 그래서 롤백 실패는 **재시도하지 않고** 즉시
   * 포기해야 한다 — 재시도 코드를 달고 나가면 안 된다.
   */
  test('ROLLBACK 이 실패하면 재시도하지 않고 즉시 포기한다(25P02 방지)', async () => {
    const pgErr = (code: string, msg = code): Error => Object.assign(new Error(msg), { code })
    let beginCount = 0
    const query = vi.fn(async (sql: string) => {
      const s = sql.trim()
      if (/SELECT\s+version\s+FROM\s+\w*schema_migrations/i.test(s)) return { rows: [] }
      if (/^BEGIN$/i.test(s)) { beginCount++; return { rows: [] } }
      if (/^ROLLBACK$/i.test(s)) throw pgErr('XX000', 'rollback failed')
      if (/pg_advisory_(un)?lock|schema_migrations/i.test(s)) return { rows: [] }
      throw pgErr('40P01', 'deadlock detected') // 마이그레이션 본문
    })
    const release = vi.fn()
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool

    await expect(runMigrations(pool)).rejects.toThrow()
    // BEGIN 은 딱 한 번 — 롤백이 실패했는데 재시도했다면 2회 이상이다.
    expect(beginCount).toBe(1)
    expect(release).toHaveBeenCalledTimes(1)
  })
})


describe('withDeadlockRetry — 트랜잭션 전체 재시도', () => {
  const noSleep = async (): Promise<void> => undefined
  const pgErr = (code: string, msg = code): Error => Object.assign(new Error(msg), { code })

  test('40P01이면 재시도해 성공한다', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(pgErr('40P01', 'deadlock detected'))
      .mockResolvedValueOnce('ok')
    expect(await withDeadlockRetry(fn, noSleep)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('40001(직렬화 실패)도 재시도 대상', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(pgErr('40001'))
      .mockResolvedValueOnce(1)
    expect(await withDeadlockRetry(fn, noSleep)).toBe(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('재시도 불가 코드는 즉시 전파하고 1회만 호출한다', async () => {
    const fn = vi.fn().mockRejectedValue(pgErr('42P01', 'undefined table'))
    await expect(withDeadlockRetry(fn, noSleep)).rejects.toThrow('undefined table')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('code 없는 에러도 즉시 전파', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(withDeadlockRetry(fn, noSleep)).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('상한(5회) 소진 후에는 포기하고 throw', async () => {
    const fn = vi.fn().mockRejectedValue(pgErr('40P01', 'deadlock detected'))
    await expect(withDeadlockRetry(fn, noSleep)).rejects.toThrow('deadlock detected')
    expect(fn).toHaveBeenCalledTimes(5)
  })

  test('백오프는 시도회수에 비례한다(50·100·150·200ms)', async () => {
    const waits: number[] = []
    const fn = vi.fn().mockRejectedValue(pgErr('40P01'))
    await expect(withDeadlockRetry(fn, async (ms) => { waits.push(ms) })).rejects.toThrow()
    expect(waits).toEqual([50, 100, 150, 200])
  })
})
