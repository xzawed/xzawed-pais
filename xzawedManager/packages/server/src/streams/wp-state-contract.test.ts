import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WP_STATES, WP_TRANSITIONS, WorkPackageSchema } from '@xzawed/agent-streams'
import {
  DRAFTED_STATE, DISPATCHED_STATE, DONE_STATE, ESCALATED_STATE,
  LEASE_ACTIVE, LEASE_ESCALATED, LEASE_RELEASED,
} from './dispatch-constants.js'

/**
 * **교차 모듈 계약 테스트**(S6.1 / 수용 기준 L2-5).
 *
 * tsc 는 이 경계를 교차검증하지 못한다 — Manager 가 자기 상수를 독립 선언하면 shared enum 과
 * 갈려도 컴파일이 통과한다. 실제로 그래서 **교집합이 0** 인 채로 오래 있었다.
 * 여기서 값 집합을 런타임에 대조한다.
 */

describe('Manager 디스패치 상수 ↔ shared 정본 enum', () => {
  it('Manager 가 쓰는 모든 상태가 정본 enum 안에 있다', () => {
    const known = new Set<string>(WP_STATES)
    for (const s of [DRAFTED_STATE, DISPATCHED_STATE, DONE_STATE, ESCALATED_STATE]) {
      expect(known.has(s), `${s} 가 정본 enum 밖이다`).toBe(true)
    }
  })

  it('두 정본의 교집합이 0 이 아니다(S6.1 이전 상태로의 회귀 차단)', () => {
    const managerStates = new Set([DRAFTED_STATE, DISPATCHED_STATE, DONE_STATE, ESCALATED_STATE])
    const shared = new Set<string>(WP_STATES)
    const intersection = [...managerStates].filter((s) => shared.has(s))
    expect(intersection).toHaveLength(managerStates.size)
  })

  it('WorkPackage 기본 상태가 디스패치 전이의 from 과 같다', () => {
    const wp = WorkPackageSchema.parse({ id: 'a', storyId: 's', owningRole: 'r', oracleRef: null })
    expect(wp.status).toBe(DRAFTED_STATE)
  })

  /**
   * lease 상태는 **정당하게 별개 공간**이다(`wp_leases.status`). 통합 대상이 아니라는 것을 고정한다 —
   * 영어 단어가 겹쳐(`escalated` vs `ESCALATED`) 나중에 누가 합치려 들 수 있다.
   * 합치면 `lease.status === ESCALATED_STATE` 가 영구 false 가 된다.
   */
  it('lease 상태는 WP 상태 공간과 교집합이 0 이다(분리 유지)', () => {
    const wpSpace = new Set<string>(WP_STATES)
    for (const l of [LEASE_ACTIVE, LEASE_ESCALATED, LEASE_RELEASED]) {
      expect(wpSpace.has(l), `lease 상태 ${l} 가 WP 공간과 겹친다`).toBe(false)
    }
  })

  /**
   * DB CHECK 제약도 같은 값 집합이어야 한다. SQL 리터럴은 tsc 사각지대라
   * enum 에 상태를 추가하고 마이그레이션을 잊으면 **INSERT 가 런타임에 거부된다** —
   * 그 실패는 자율 아크가 켜진 뒤에야 드러난다.
   */
  it('마이그레이션 CHECK 제약의 값 집합이 정본 enum 과 일치한다', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf-8'))
      .join('\n')

    const checks = [...sql.matchAll(/CHECK\s*\([^)]*?(?:to_state|from_state)\s+IN\s*\(([^)]*)\)/gi)]
    expect(checks.length, 'wp_state_log 상태 CHECK 제약이 없다').toBeGreaterThan(0)

    for (const m of checks) {
      const values = [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!)
      expect(values.sort(), `CHECK 목록이 enum 과 다르다: ${m[1]}`).toEqual([...WP_STATES].sort())
    }
  })

  it('전이표가 프로덕션 writer 5종을 전부 허용한다', () => {
    // db/lease.repo.ts · db/dispatch.repo.ts 가 실제로 기록하는 전이.
    const production: Array<[string, string]> = [
      [DRAFTED_STATE, DISPATCHED_STATE],
      [DISPATCHED_STATE, DISPATCHED_STATE],
      [DISPATCHED_STATE, ESCALATED_STATE],
      [ESCALATED_STATE, DISPATCHED_STATE],
      [DISPATCHED_STATE, DONE_STATE],
    ]
    for (const [from, to] of production) {
      const allowed = WP_TRANSITIONS[from as keyof typeof WP_TRANSITIONS] as readonly string[]
      expect(allowed.includes(to), `전이표가 ${from} → ${to} 를 막는다(런타임이 죽는다)`).toBe(true)
    }
  })
})
