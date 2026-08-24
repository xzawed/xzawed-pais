import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findNonIdempotentDdl, isMigrationFile, parseMigrationVersion } from '../db/migration-guard.js'

/**
 * 마이그레이션 멱등성 정적 회귀 가드(무DB·hermetic) — 실제 파일 전수 스캔.
 *
 * **왜 버전 추적(S3.4) 이후에도 남는가.** 러너는 이제 `schema_migrations`로 미적용분만
 * 적용하지만(`db/pool.ts`), 추적 테이블이 없던 **기존 DB가 새 러너로 처음 뜨는 창**이 있다 —
 * 기록이 비어 있으므로 전 마이그레이션이 한 번 더 돈다. 그 한 번이 안전한 유일한 근거가
 * 기존 파일의 멱등성이고, 이 스캔이 그것을 소스에서 강제한다.
 *
 * 판정 규칙 자체는 `db/migration-guard.ts`가 갖는다(단위 계약은 `db/migration-guard.test.ts`).
 * 여기서 다시 구현하지 않는다 — 두 벌이 되면 CPD 게이트에 걸릴 뿐 아니라 규칙이 갈라진다.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

describe('마이그레이션 멱등성(정적 — 베이스라인 재실행 안전)', () => {
  const all = readdirSync(migrationsDir)
  const files = all.filter(isMigrationFile).sort()

  it('마이그레이션 파일이 발견된다(sanity)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('디렉토리의 .sql 이 전부 규약을 따른다(러너가 조용히 빠뜨리는 파일 0건)', () => {
    const strays = all.filter((f) => f.endsWith('.sql') && !isMigrationFile(f))
    expect(strays, `러너가 무시할 .sql: ${strays.join(', ')}`).toEqual([])
  })

  it('버전 번호가 001부터 빈틈없이 이어진다(중복 prefix·건너뜀 0건)', () => {
    const versions = files.map((f) => parseMigrationVersion(f)!)
    expect(versions).toEqual([...Array(files.length)].map((_, i) => i + 1))
  })

  it.each(files)('%s — 모든 DDL이 멱등(재실행 시 already-exists throw 없음)', (file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    const violations = findNonIdempotentDdl(sql)
    expect(violations, `${file}에 비-멱등 DDL: ${violations.join(', ')}`).toEqual([])
  })
})
