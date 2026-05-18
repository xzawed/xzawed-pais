import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createPool, runMigrationsFromDir, closePool } from '../db/pool.js'

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? ''
const hasDb = DATABASE_URL !== ''

describe.skipIf(!hasDb)('Migration runner', () => {
  let pool: Pool
  let tmpDir: string

  beforeAll(async () => {
    pool = createPool(DATABASE_URL)
    tmpDir = join(tmpdir(), `xzawed-migrate-test-${randomUUID()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS schema_migrations CASCADE').catch(() => {})
    await rm(tmpDir, { recursive: true, force: true })
    await closePool()
  })

  it('빈 DB에서 001 마이그레이션을 적용한다', async () => {
    await writeFile(join(tmpDir, '001_test.sql'), 'CREATE TABLE _mt_test_a (id INT);')
    await runMigrationsFromDir(pool, tmpDir)

    const { rows } = await pool.query<{ version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version'
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.version).toBe(1)
    expect(rows[0]?.name).toBe('001_test.sql')
  })

  it('이미 적용된 마이그레이션은 재실행하지 않는다', async () => {
    await runMigrationsFromDir(pool, tmpDir)

    const { rows } = await pool.query(
      'SELECT version FROM schema_migrations'
    )
    expect(rows).toHaveLength(1)
  })

  it('002 마이그레이션을 순서대로 추가 적용한다', async () => {
    await writeFile(join(tmpDir, '002_test.sql'), 'CREATE TABLE _mt_test_b (id INT);')
    await runMigrationsFromDir(pool, tmpDir)

    const { rows } = await pool.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    )
    expect(rows.map(r => r.version)).toEqual([1, 2])
  })

  it('잘못된 SQL 마이그레이션은 롤백되고 에러를 던진다', async () => {
    await writeFile(join(tmpDir, '003_bad.sql'), 'THIS IS NOT VALID SQL !!!;')

    await expect(runMigrationsFromDir(pool, tmpDir)).rejects.toThrow()

    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version')
    expect(rows.map((r: { version: number }) => r.version)).toEqual([1, 2])
  })

  it('schema_migrations 테이블이 없는 상태에서 자동 생성된다', async () => {
    const { rows } = await pool.query(`
      SELECT to_regclass('public.schema_migrations') AS tbl
    `)
    expect(rows[0]?.tbl).toBe('schema_migrations')
  })
})
