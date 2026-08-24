import { describe, it, expect } from 'vitest'
import {
  WP_STATES,
  WpStatusSchema,
  WP_TRANSITIONS,
  canTransition,
  isTerminalWpState,
} from '../types/wp-state.js'
import { WorkPackageSchema } from '../types/work-package.js'

/**
 * WP 상태 **정본 계약**(S6.1).
 *
 * 수용 기준 L2-5 — "WP 상태 정본 enum 과 상태 전이표의 값 집합이 일치한다".
 * S6.1 이전에는 정본이 둘(실은 셋)로 갈려 **교집합이 0** 이었다:
 * 소문자 `draft|ready|in_progress|blocked|done`(shared 스키마) vs
 * 대문자 `DRAFTED|DISPATCHED|DONE|ESCALATED`(Manager 디스패치·`wp_state_log`) vs
 * 테스트만 쓰던 `READY`. 값이 겹치지 않으므로 한쪽을 읽는 술어는 다른 쪽이 쓴 값을 **영원히 못 본다**.
 */

describe('WP 상태 정본 enum', () => {
  it('중복 없는 값 집합이다', () => {
    expect(new Set(WP_STATES).size).toBe(WP_STATES.length)
  })

  it('Zod enum 과 상수 배열이 같은 집합이다', () => {
    expect([...WpStatusSchema.options].sort()).toEqual([...WP_STATES].sort())
  })

  it('WorkPackage.status 가 이 enum 을 쓴다(정본 하나)', () => {
    for (const s of WP_STATES) {
      expect(WorkPackageSchema.parse({ id: 'a', storyId: 's', owningRole: 'r', oracleRef: null, status: s }).status)
        .toBe(s)
    }
  })

  it('WorkPackage.status 기본값은 DRAFTED 다', () => {
    expect(WorkPackageSchema.parse({ id: 'a', storyId: 's', owningRole: 'r', oracleRef: null }).status)
      .toBe('DRAFTED')
  })

  it('레거시 소문자 값은 거부한다(두 정본이 공존하지 않는다)', () => {
    for (const legacy of ['draft', 'ready', 'in_progress', 'blocked', 'done']) {
      expect(WpStatusSchema.safeParse(legacy).success, `${legacy} 가 통과했다`).toBe(false)
    }
  })
})

describe('상태 전이표', () => {
  it('전이표의 키 집합이 enum 과 정확히 일치한다', () => {
    expect(Object.keys(WP_TRANSITIONS).sort()).toEqual([...WP_STATES].sort())
  })

  it('전이표의 모든 목적지가 enum 안에 있다(L2-5)', () => {
    const known = new Set<string>(WP_STATES)
    for (const [from, tos] of Object.entries(WP_TRANSITIONS)) {
      for (const to of tos) {
        expect(known.has(to), `${from} → ${to} 의 목적지가 enum 밖이다`).toBe(true)
      }
    }
  })

  it('DONE 은 종단이다', () => {
    expect(WP_TRANSITIONS.DONE).toEqual([])
    expect(isTerminalWpState('DONE')).toBe(true)
    expect(isTerminalWpState('DISPATCHED')).toBe(false)
  })

  /**
   * 프로덕션이 실제로 기록하는 전이 5종(`db/lease.repo.ts`·`db/dispatch.repo.ts` 실측).
   * 전이표가 이걸 막으면 런타임이 죽는다 — 표가 코드보다 좁아지는 회귀를 여기서 잡는다.
   */
  it.each([
    ['DRAFTED', 'DISPATCHED', 'recordDispatch'],
    ['DISPATCHED', 'DISPATCHED', 'recordReclaim(자기 루프)'],
    ['DISPATCHED', 'ESCALATED', 'recordEscalation'],
    ['ESCALATED', 'DISPATCHED', 'reopenLease'],
    ['DISPATCHED', 'DONE', 'recordCompletion'],
  ] as const)('%s → %s 를 허용한다(%s)', (from, to, _writer) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it('정의되지 않은 전이는 거부한다', () => {
    expect(canTransition('DONE', 'DISPATCHED')).toBe(false)
    expect(canTransition('DRAFTED', 'DONE')).toBe(false)
  })

  it('최초 전이(from=null)는 어떤 상태로도 허용한다(로그의 from_state 는 nullable)', () => {
    for (const s of WP_STATES) expect(canTransition(null, s)).toBe(true)
  })

  it('모든 비종단 상태는 DRAFTED 에서 도달 가능하다(고아 상태 0)', () => {
    const seen = new Set<string>(['DRAFTED'])
    const queue = ['DRAFTED']
    while (queue.length > 0) {
      for (const to of WP_TRANSITIONS[queue.shift()! as keyof typeof WP_TRANSITIONS]) {
        if (!seen.has(to)) { seen.add(to); queue.push(to) }
      }
    }
    expect([...seen].sort()).toEqual([...WP_STATES].sort())
  })
})
