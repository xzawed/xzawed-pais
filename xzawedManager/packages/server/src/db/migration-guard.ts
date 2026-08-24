/**
 * 마이그레이션 파일 규약 + 비-멱등 DDL 정적 가드(S3.4).
 *
 * 러너가 버전 추적을 갖게 된 뒤에도 이 가드는 남는다 — **기존 DB 의 베이스라인 재실행 창** 때문이다.
 * 추적 테이블이 없던 DB 가 새 러너로 처음 뜨면 기록이 빈 상태라 전 마이그레이션이 **한 번 더** 돈다.
 * 그 한 번이 안전한 유일한 이유가 기존 파일이 전부 멱등이라는 것이고, 이 가드가 그것을 소스에서 강제한다.
 *
 * 세 부류를 구분한다.
 *
 * 1. **`IF NOT EXISTS` 절이 있는 DDL** — `CREATE TABLE`·`CREATE INDEX`·`ADD COLUMN`·`CREATE SEQUENCE`.
 *    절을 붙이면 멱등이 된다.
 * 2. **`OR REPLACE` 가 있는 DDL** — `CREATE TRIGGER`(PG 14+).
 * 3. **둘 다 없는 DDL** — `ADD CONSTRAINT` 와 이름 없는 제약 형태(`ADD PRIMARY KEY`·`ADD UNIQUE`·
 *    `ADD FOREIGN KEY`·`ADD CHECK`), 그리고 `CREATE TYPE`. Postgres 에 해당 문법이 **없다.**
 *    멱등화 수단은 카탈로그 조회 가드(`pg_constraint`·`pg_type`)나
 *    `DO $$ ... EXCEPTION WHEN duplicate_object $$` 뿐이라, 판정도 "가드 영역 안에 있는가"로 한다.
 *
 * **가드는 블록이 아니라 영역 단위로 본다.** 같은 `DO $$` 안에 무관한 카탈로그 조회가 있다는
 * 이유로 형제 문장까지 면제하면, "가드가 있다"는 판정이 실제 보호와 무관해진다.
 */

/** 러너가 인식하는 마이그레이션 파일명. 3자리 이상이라 999 에서 조용히 끊기지 않는다. */
export const MIGRATION_FILE_RE = /^(\d{3,})_.+\.sql$/

export function isMigrationFile(name: string): boolean {
  return MIGRATION_FILE_RE.test(name)
}

/** 파일명 → 버전(10진수). 규약을 벗어나면 null. */
export function parseMigrationVersion(name: string): number | null {
  const m = MIGRATION_FILE_RE.exec(name)
  return m ? Number.parseInt(m[1]!, 10) : null
}

/**
 * 주석(--)을 제거해 오탐 방지 + 연속 공백 정규화(개행 포함 단일 라인화).
 *
 * **개행을 먼저 정규화해야 한다.** 이 저장소는 `core.autocrlf=true` 라 작업 트리 파일이 CRLF 인데,
 * JS 정규식의 `.` 은 `\r` 를 넘지 않고 `$` 는 `m` 없이 문자열 끝만 본다 — `/--.*$/` 로는
 * `-- 주석\r` 이 매칭되지 않아 **주석이 그대로 남고 오탐이 난다.**
 * Linux CI(LF)는 통과하고 Windows 로컬만 깨지는 불일치라 실제로 018 의 설명 주석에 있던
 * `ADD CONSTRAINT` 가 위반으로 잡혔다.
 */
export function normalize(sql: string): string {
  return sql
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/--.*/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
}

/** 카탈로그 존재 조회로 시작하는 `IF NOT EXISTS (...) THEN ... END IF;` 영역. */
const CATALOG_GUARD_REGION =
  /IF\s+NOT\s+EXISTS\s*\(\s*SELECT\b[^)]*?\bFROM\s+(?:pg_catalog\.)?(?:pg_constraint|pg_type)\b.*?END\s+IF\s*;/gi

/** `DO $tag$ ... $tag$` 블록(태그 있는 달러 인용 포함). */
const DO_BLOCK = /DO\s+\$(\w*)\$(.*?)\$\1\$/gi

/** duplicate_object 를 흡수하는 예외 핸들러 — 블록 전체를 덮는다. */
const DUPLICATE_OBJECT_HANDLER = /EXCEPTION\s+WHEN\b[^;]*\bduplicate_object\b/i

/**
 * 존재 가드가 실제로 덮는 영역만 걷어낸다. 남은 텍스트가 무가드 DDL 판정 대상이다.
 * 순서가 중요하다 — 예외 핸들러는 블록 전체를 덮으므로 먼저 처리한다.
 */
function stripGuardedRegions(text: string): string {
  const withoutHandlerBlocks = text.replace(DO_BLOCK, (whole, _tag: string, body: string) =>
    DUPLICATE_OBJECT_HANDLER.test(body) ? ' ' : whole,
  )
  return withoutHandlerBlocks.replace(CATALOG_GUARD_REGION, ' ')
}

/** IF NOT EXISTS(또는 존재 가드)가 빠진 비-멱등 DDL을 찾는다(파일당 위반 목록). */
export function findNonIdempotentDdl(sql: string): string[] {
  const text = normalize(sql)
  const unguarded = stripGuardedRegions(text)
  const violations: string[] = []

  // 절을 붙이면 멱등이 되는 것들 — 전체 텍스트에서 본다(가드와 무관).
  const clauseChecks: Array<[RegExp, string]> = [
    [/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE INDEX without IF NOT EXISTS'],
    [/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TABLE without IF NOT EXISTS'],
    [/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i, 'ADD COLUMN without IF NOT EXISTS'],
    [/CREATE\s+SEQUENCE\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE SEQUENCE without IF NOT EXISTS'],
    [/CREATE\s+TRIGGER\s+/i, 'CREATE TRIGGER without OR REPLACE'],
  ]
  for (const [re, label] of clauseChecks) {
    if (re.test(text)) violations.push(label)
  }

  // 절이 존재하지 않는 것들 — 가드 영역을 걷어낸 뒤에 본다.
  const guardChecks: Array<[RegExp, string]> = [
    [/ADD\s+CONSTRAINT\s+/i, 'ADD CONSTRAINT without existence guard'],
    [/ADD\s+PRIMARY\s+KEY\b/i, 'ADD PRIMARY KEY without existence guard'],
    [/ADD\s+UNIQUE\b/i, 'ADD UNIQUE without existence guard'],
    [/ADD\s+FOREIGN\s+KEY\b/i, 'ADD FOREIGN KEY without existence guard'],
    [/ADD\s+CHECK\b/i, 'ADD CHECK without existence guard'],
    [/CREATE\s+TYPE\s+/i, 'CREATE TYPE without existence guard'],
  ]
  for (const [re, label] of guardChecks) {
    if (re.test(unguarded)) violations.push(label)
  }

  return violations
}
