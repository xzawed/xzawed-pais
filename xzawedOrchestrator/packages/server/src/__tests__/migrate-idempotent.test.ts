import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 마이그레이션 멱등성 정적 회귀 가드(무DB·hermetic).
 *
 * runMigrations는 schema_migrations로 적용 버전을 추적하나, 공유 로컬 pg에서 **객체는 존재하는데
 * tracking이 유실된 out-of-sync 상태**(schema_migrations만 드롭·다른 서비스가 선점·부분 리셋)에서는
 * migration이 재실행된다. 그때 DDL이 IF NOT EXISTS가 아니면 `CREATE INDEX ... already exists`(42P07)로
 * 죽어 로컬 테스트가 파일-레벨 실패한다(CI는 fresh pg라 무영향·#403 Manager 데드락과 유사 계열).
 *
 * 런타임 재실행-무해성은 IF NOT EXISTS가 보장한다. 이 테스트는 그 불변식을 **소스에서** 강제해
 * 새 비-멱등 DDL이 유입되는 회귀를 차단한다(실 DB 실행은 공유 스위트를 교란하므로 정적 검사로 대체).
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

/** 주석(--)을 제거해 오탐 방지 + 대소문자·연속 공백 정규화. */
function normalize(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
}

/** IF NOT EXISTS가 빠진 비-멱등 DDL을 찾는다(파일당 위반 목록). */
function findNonIdempotentDdl(sql: string): string[] {
  const text = normalize(sql)
  const violations: string[] = []
  const checks: Array<[RegExp, string]> = [
    // CREATE [UNIQUE] INDEX <name> ...  — IF NOT EXISTS가 곧바로 뒤따라야 한다.
    [/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE INDEX without IF NOT EXISTS'],
    // CREATE TABLE <name> ...
    [/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE without IF NOT EXISTS'],
    // ALTER TABLE ... ADD COLUMN <name>  (ADD COLUMN IF NOT EXISTS <name> 필요)
    [/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, 'ADD COLUMN without IF NOT EXISTS'],
  ]
  for (const [re, label] of checks) {
    if (re.test(text)) violations.push(label)
  }
  return violations
}

describe('마이그레이션 멱등성(정적 — out-of-sync 재실행 안전)', () => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()

  it('마이그레이션 파일이 발견된다(sanity)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s — 모든 DDL이 IF NOT EXISTS(재실행 시 already-exists throw 없음)', (file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    const violations = findNonIdempotentDdl(sql)
    expect(violations, `${file}에 비-멱등 DDL: ${violations.join(', ')}`).toEqual([])
  })
})
