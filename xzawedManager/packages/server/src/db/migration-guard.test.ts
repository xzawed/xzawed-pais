import { describe, it, expect } from 'vitest'
import { findNonIdempotentDdl, parseMigrationVersion, isMigrationFile } from './migration-guard.js'

/**
 * 비-멱등 DDL 정적 가드의 **단위 계약**(S3.4).
 *
 * `__tests__/migrate-idempotent.test.ts` 는 실제 마이그레이션 파일을 훑는 회귀 스캔이고,
 * 이 파일은 판정 함수 자체를 픽스처로 고정한다 — 실 파일에 위반이 0건이라 스캔만으로는
 * "규칙이 실제로 걸리는가"를 증명할 수 없다(위음성).
 *
 * **`ADD CONSTRAINT`·`CREATE TYPE` 은 다른 셋과 성질이 다르다.** Postgres 에
 * `ADD CONSTRAINT IF NOT EXISTS`·`CREATE TYPE IF NOT EXISTS` 가 **없다** — 그래서 처방이
 * "IF NOT EXISTS 를 붙여라"가 될 수 없고, 카탈로그 조회 가드(`pg_constraint`·`pg_type`)나
 * `DO $$ ... EXCEPTION WHEN duplicate_object $$` 로 감싸는 것이 유일한 멱등화 수단이다.
 */

describe('findNonIdempotentDdl — IF NOT EXISTS 계열', () => {
  it('맨 CREATE TABLE 을 위반으로 잡는다', () => {
    expect(findNonIdempotentDdl('CREATE TABLE t (id INT);')).toContain(
      'CREATE TABLE without IF NOT EXISTS',
    )
  })

  it('CREATE TABLE IF NOT EXISTS 는 통과시킨다', () => {
    expect(findNonIdempotentDdl('CREATE TABLE IF NOT EXISTS t (id INT);')).toEqual([])
  })

  it('맨 CREATE INDEX·CREATE UNIQUE INDEX 를 위반으로 잡는다', () => {
    expect(findNonIdempotentDdl('CREATE INDEX i ON t (c);')).toContain(
      'CREATE INDEX without IF NOT EXISTS',
    )
    expect(findNonIdempotentDdl('CREATE UNIQUE INDEX i ON t (c);')).toContain(
      'CREATE INDEX without IF NOT EXISTS',
    )
  })

  it('맨 ADD COLUMN 을 위반으로 잡는다', () => {
    expect(findNonIdempotentDdl('ALTER TABLE t ADD COLUMN c TEXT;')).toContain(
      'ADD COLUMN without IF NOT EXISTS',
    )
  })

  it('주석 안의 DDL 은 오탐하지 않는다', () => {
    expect(findNonIdempotentDdl('-- CREATE TABLE t (id INT);\nSELECT 1;')).toEqual([])
  })

  /**
   * **CRLF 회귀.** 이 저장소는 `core.autocrlf=true` 라 작업 트리 파일이 CRLF 다.
   * JS 정규식의 `.` 은 `\r` 를 넘지 않고 `$` 는 `m` 없이 문자열 끝만 보므로,
   * `/--.*$/` 는 `-- 주석\r` 을 **매칭하지 못한다** → 주석이 안 지워져 오탐이 난다.
   * Linux CI(LF)에서는 통과하고 Windows 로컬에서만 깨지는, 가장 나쁜 종류의 불일치다.
   * (실제로 018 마이그레이션의 설명 주석에 있는 `ADD CONSTRAINT` 가 위반으로 잡혔다.)
   */
  it.each([
    ['CRLF', '\r\n'],
    ['LF', '\n'],
    ['CR', '\r'],
  ])('%s 개행에서도 주석을 제거한다', (_label, eol) => {
    const sql = `-- ADD CONSTRAINT 는 카탈로그 가드가 필요하다${eol}-- CREATE TABLE t (id INT);${eol}SELECT 1;`
    expect(findNonIdempotentDdl(sql)).toEqual([])
  })

  it('CRLF 파일에서도 진짜 위반은 여전히 잡는다(과잉 제거 아님)', () => {
    expect(findNonIdempotentDdl('-- 설명\r\nCREATE TABLE t (id INT);\r\n'))
      .toContain('CREATE TABLE without IF NOT EXISTS')
  })
})

describe('findNonIdempotentDdl — IF NOT EXISTS 가 존재하지 않는 DDL', () => {
  it('가드 없는 ADD CONSTRAINT 는 비멱등으로 판정된다', () => {
    const sql = "ALTER TABLE wp_state_log ADD CONSTRAINT wp_state_log_to_state_chk CHECK (to_state <> '');"
    expect(findNonIdempotentDdl(sql)).toContain('ADD CONSTRAINT without existence guard')
  })

  it('pg_constraint 카탈로그 가드로 감싼 ADD CONSTRAINT 는 통과시킨다', () => {
    const sql = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_state_log_to_state_chk') THEN
          ALTER TABLE wp_state_log ADD CONSTRAINT wp_state_log_to_state_chk CHECK (to_state <> '');
        END IF;
      END $$;
    `
    expect(findNonIdempotentDdl(sql)).toEqual([])
  })

  it('duplicate_object 예외 처리로 감싼 ADD CONSTRAINT 는 통과시킨다', () => {
    const sql = `
      DO $$ BEGIN
        ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `
    expect(findNonIdempotentDdl(sql)).toEqual([])
  })

  it('가드 없는 CREATE TYPE 은 비멱등으로 판정된다', () => {
    expect(findNonIdempotentDdl("CREATE TYPE wp_status AS ENUM ('DRAFTED', 'DONE');")).toContain(
      'CREATE TYPE without existence guard',
    )
  })

  it('pg_type 카탈로그 가드로 감싼 CREATE TYPE 은 통과시킨다', () => {
    const sql = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wp_status') THEN
          CREATE TYPE wp_status AS ENUM ('DRAFTED', 'DONE');
        END IF;
      END $$;
    `
    expect(findNonIdempotentDdl(sql)).toEqual([])
  })

  it('한 파일에 가드된 것과 안 된 것이 섞이면 위반으로 판정한다', () => {
    const sql = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a_chk') THEN
          ALTER TABLE a ADD CONSTRAINT a_chk CHECK (x > 0);
        END IF;
      END $$;
      ALTER TABLE b ADD CONSTRAINT b_chk CHECK (y > 0);
    `
    expect(findNonIdempotentDdl(sql)).toContain('ADD CONSTRAINT without existence guard')
  })

  // 반증 케이스 — 가드는 **블록 단위가 아니라 IF 영역 단위**여야 한다.
  // 같은 DO 블록 안에 무관한 카탈로그 조회가 있다는 이유로 형제 문장이 면제되면
  // "가드가 있다"는 판정이 실제 보호와 무관해진다.
  it('같은 DO 블록 안이라도 IF 밖의 ADD CONSTRAINT 는 잡는다', () => {
    const sql = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unrelated') THEN
          NULL;
        END IF;
        ALTER TABLE t ADD CONSTRAINT t_chk CHECK (x > 0);
      END $$;
    `
    expect(findNonIdempotentDdl(sql)).toContain('ADD CONSTRAINT without existence guard')
  })
})

/**
 * `ADD CONSTRAINT` 만 막으면 우회로가 남는다 — 이름 없는 제약 형태(`ADD PRIMARY KEY` 등)는
 * 같은 42710 을 내면서 그 리터럴을 포함하지 않는다.
 */
describe('findNonIdempotentDdl — 이름 없는 제약·기타 비멱등 객체', () => {
  it.each([
    ['ALTER TABLE t ADD PRIMARY KEY (id);', 'ADD PRIMARY KEY'],
    ['ALTER TABLE t ADD UNIQUE (email);', 'ADD UNIQUE'],
    ['ALTER TABLE t ADD FOREIGN KEY (uid) REFERENCES users(id);', 'ADD FOREIGN KEY'],
    ['ALTER TABLE t ADD CHECK (x > 0);', 'ADD CHECK'],
  ])('%s 를 위반으로 잡는다', (sql) => {
    expect(findNonIdempotentDdl(sql).length).toBeGreaterThan(0)
  })

  it('CREATE SEQUENCE 는 IF NOT EXISTS 가 필요하다', () => {
    expect(findNonIdempotentDdl('CREATE SEQUENCE s;')).toContain('CREATE SEQUENCE without IF NOT EXISTS')
    expect(findNonIdempotentDdl('CREATE SEQUENCE IF NOT EXISTS s;')).toEqual([])
  })

  it('CREATE TRIGGER 는 OR REPLACE 나 존재 가드가 필요하다', () => {
    expect(findNonIdempotentDdl('CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();'))
      .toContain('CREATE TRIGGER without OR REPLACE')
    expect(findNonIdempotentDdl('CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();'))
      .toEqual([])
  })

  it('duplicate_object 흡수 블록 안이면 이름 없는 제약도 통과시킨다', () => {
    const sql = `
      DO $$ BEGIN
        ALTER TABLE t ADD PRIMARY KEY (id);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `
    expect(findNonIdempotentDdl(sql)).toEqual([])
  })
})

/**
 * 파일명 → 버전 판정. 러너와 전수 스캔 테스트가 **같은 규칙**을 써야 한다 —
 * 규칙이 갈리면 러너가 무시하는 파일을 스캔도 못 보는 이중 사각지대가 생긴다.
 */
describe('마이그레이션 파일명 규약', () => {
  it('3자리 prefix 를 10진수로 읽는다(008 을 8진수로 읽지 않는다)', () => {
    expect(parseMigrationVersion('008_wp_leases.sql')).toBe(8)
    expect(parseMigrationVersion('017_tenant_tagging.sql')).toBe(17)
  })

  it('3자리를 넘는 번호도 인식한다(999 에서 조용히 끊기지 않는다)', () => {
    expect(isMigrationFile('1000_next.sql')).toBe(true)
    expect(parseMigrationVersion('1000_next.sql')).toBe(1000)
  })

  it('규약을 벗어난 이름은 마이그레이션이 아니다', () => {
    expect(isMigrationFile('README.md')).toBe(false)
    expect(isMigrationFile('01_short.sql')).toBe(false)
    expect(isMigrationFile('abc_x.sql')).toBe(false)
    expect(parseMigrationVersion('README.md')).toBeNull()
  })
})
