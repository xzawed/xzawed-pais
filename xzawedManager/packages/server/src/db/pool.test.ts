import { describe, test, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { runMigrations } from './pool.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

describe('runMigrations', () => {
  test('migrations 디렉터리의 모든 .sql을 파일명 정렬 순으로 적용한다', async () => {
    const expected = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
    const query = vi.fn().mockResolvedValue({ rows: [] })

    await runMigrations({ query } as unknown as Pool)

    expect(query).toHaveBeenCalledTimes(expected.length)
    // 적용 순서 = 파일명 사전 정렬 순서(번호 prefix 보장)
    for (let i = 0; i < expected.length; i++) {
      const sql = await readFile(join(migrationsDir, expected[i]!), 'utf-8')
      expect(query.mock.calls[i]![0]).toBe(sql)
    }
  })

  test('approver 컬럼 마이그레이션(004)을 적용한다', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })

    await runMigrations({ query } as unknown as Pool)

    const applied = query.mock.calls.map((c) => c[0] as string)
    expect(applied.some((sql) => /ADD COLUMN IF NOT EXISTS approver/i.test(sql))).toBe(true)
  })
})
