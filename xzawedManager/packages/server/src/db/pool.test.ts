import { describe, test, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { runMigrations, applyMigration } from './pool.js'

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

// 공유 테스트 DB에서 마이그레이션 DDL(ShareLock/AccessExclusiveLock)과 동시 DML(RowExclusiveLock)의
// 반대-순서 락 경합이 rare 데드락(40P01)을 일으켜 CI에서 무관 PR을 red로 만들던 flake 완화.
// 마이그레이션은 IF NOT EXISTS 멱등 + 파일당 단일 트랜잭션이라 데드락 시 전체 롤백·재적용 안전.
const noSleep = async (): Promise<void> => {}
function pgError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}

describe('applyMigration — 데드락/직렬화 재시도', () => {
  test('첫 시도 성공 시 재시도하지 않는다(정상 경로 회귀 0)', async () => {
    const query = vi.fn().mockResolvedValue(undefined)
    await applyMigration({ query }, 'CREATE INDEX ...', noSleep)
    expect(query).toHaveBeenCalledTimes(1)
  })

  test('40P01(deadlock_detected) 후 성공하면 재시도해 통과한다', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(pgError('40P01', 'deadlock detected'))
      .mockResolvedValueOnce(undefined)
    await applyMigration({ query }, 'CREATE INDEX ...', noSleep)
    expect(query).toHaveBeenCalledTimes(2)
  })

  test('40001(serialization_failure)도 재시도 대상이다', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(pgError('40001', 'could not serialize'))
      .mockResolvedValueOnce(undefined)
    await applyMigration({ query }, 'sql', noSleep)
    expect(query).toHaveBeenCalledTimes(2)
  })

  test('재시도 불가 에러(예: 42P01)는 즉시 전파한다(재시도 없음)', async () => {
    const query = vi.fn().mockRejectedValue(pgError('42P01', 'undefined table'))
    await expect(applyMigration({ query }, 'sql', noSleep)).rejects.toThrow('undefined table')
    expect(query).toHaveBeenCalledTimes(1)
  })

  test('code 없는 일반 에러도 즉시 전파한다', async () => {
    const query = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(applyMigration({ query }, 'sql', noSleep)).rejects.toThrow('boom')
    expect(query).toHaveBeenCalledTimes(1)
  })

  test('상한(5회)까지 데드락이 지속되면 마지막 에러를 전파한다(무한 재시도 방지)', async () => {
    const query = vi.fn().mockRejectedValue(pgError('40P01', 'deadlock detected'))
    await expect(applyMigration({ query }, 'sql', noSleep)).rejects.toThrow('deadlock detected')
    expect(query).toHaveBeenCalledTimes(5)
  })
})
