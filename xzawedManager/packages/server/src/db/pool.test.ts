import { describe, test, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { runMigrations } from './pool.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** runMigrations는 전용 client(advisory lock 직렬화)로 실행 — connect/release까지 mock. */
function mockPool() {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { pool: { connect } as unknown as Pool, query, release, connect }
}

describe('runMigrations', () => {
  test('advisory lock 안에서 모든 .sql을 파일명 정렬 순으로 적용하고 unlock·release한다', async () => {
    const expected = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
    const { pool, query, release } = mockPool()

    await runMigrations(pool)

    // 호출 구조: [advisory_lock, ...sql 파일들(사전 정렬 순), advisory_unlock]
    expect(query).toHaveBeenCalledTimes(expected.length + 2)
    expect(String(query.mock.calls[0]![0])).toMatch(/pg_advisory_lock/)
    expect(String(query.mock.calls[expected.length + 1]![0])).toMatch(/pg_advisory_unlock/)
    for (let i = 0; i < expected.length; i++) {
      const sql = await readFile(join(migrationsDir, expected[i]!), 'utf-8')
      expect(query.mock.calls[i + 1]![0]).toBe(sql)
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
      .mockRejectedValueOnce(new Error('migration boom')) // 첫 .sql 실패
      .mockResolvedValue({ rows: [] }) // advisory_unlock
    const release = vi.fn()
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool

    await expect(runMigrations(pool)).rejects.toThrow(/migration boom/)
    expect(String(query.mock.calls.at(-1)![0])).toMatch(/pg_advisory_unlock/)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
