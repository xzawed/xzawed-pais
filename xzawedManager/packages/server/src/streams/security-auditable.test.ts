import { describe, it, expect } from 'vitest'
import { judgeAuditable, toAuditPath } from './verify.js'

/**
 * **감사 불능 판정**(S5.1 / 결함 D2 · 수용 기준 L1-5·L2-2).
 *
 * "취약점 없음"과 "스캔 못 함"은 다른 것이다. Security 가 아무것도 스캔하지 못해도
 * 결과는 `issues: []` 로 오고, 그것을 그대로 읽으면 **무실행이 통과로 영속된다.**
 * `auditable` 비트는 #580 이 넣었으나 소비 쪽이 그대로였다(`verify.ts` 가 파싱만 했다).
 *
 * **판정은 fail-closed 여야 한다.** `auditable` 은 optional 이므로
 * `if (a?.static?.scanned === 0) fail` 처럼 쓰면 **부재가 통과**가 된다 —
 * 그것이 이 슬라이스가 막으려던 것과 정확히 같은 무음 통과다.
 */

const full = (over: Record<string, unknown> = {}) => ({
  static: { requested: 3, scanned: 3 },
  deps: { status: 'ok' as const },
  ...over,
})

describe('judgeAuditable — 감사 가능', () => {
  it('요청한 만큼 스캔했고 deps 도 ok 면 감사 가능', () => {
    expect(judgeAuditable(full(), { droppedArtifacts: 0, sentArtifacts: 3 })).toEqual({ auditable: true })
  })

  it('deps 가 not_applicable 이면 감사 가능(매니페스트 없음은 정상)', () => {
    expect(judgeAuditable(full({ deps: { status: 'not_applicable' } }), { droppedArtifacts: 0, sentArtifacts: 3 }))
      .toEqual({ auditable: true })
  })

  it('요청이 0건이면 감사 가능으로 본다(스캔할 것이 없던 경우 — 공허 통과는 S5.2a 범위)', () => {
    expect(judgeAuditable(full({ static: { requested: 0, scanned: 0 } }), { droppedArtifacts: 0, sentArtifacts: 0 }))
      .toEqual({ auditable: true })
  })

  it('부분 스캔은 통과시킨다(증거가 0 은 아니다 — 강화는 별도 판단)', () => {
    expect(judgeAuditable(full({ static: { requested: 5, scanned: 2 } }), { droppedArtifacts: 0, sentArtifacts: 3 }))
      .toEqual({ auditable: true })
  })
})

describe('judgeAuditable — 감사 불능(fail-closed)', () => {
  it('auditable 자체가 없으면 불능이다(부재가 통과가 되면 안 된다)', () => {
    const v = judgeAuditable(undefined, { droppedArtifacts: 0, sentArtifacts: 3 })
    expect(v.auditable).toBe(false)
    expect(v).toHaveProperty('reason')
  })

  it('static 집계가 없으면 불능이다', () => {
    expect(judgeAuditable({ deps: { status: 'ok' } }, { droppedArtifacts: 0, sentArtifacts: 3 }).auditable).toBe(false)
  })

  it.each([
    [{ requested: 3 }, 'scanned 부재'],
    [{ scanned: 3 }, 'requested 부재'],
    [{}, '둘 다 부재'],
  ])('집계 필드가 불완전하면 불능이다 — %s', (stat) => {
    expect(judgeAuditable(full({ static: stat }), { droppedArtifacts: 0, sentArtifacts: 3 }).auditable).toBe(false)
  })

  it('요청은 있는데 하나도 스캔 못 했으면 불능이다(핵심 사례)', () => {
    const v = judgeAuditable(full({ static: { requested: 4, scanned: 0 } }), { droppedArtifacts: 0, sentArtifacts: 3 })
    expect(v.auditable).toBe(false)
    expect(v.auditable === false && v.reason).toMatch(/4/)
  })

  it('의존성 감사가 unavailable 이면 불능이다', () => {
    expect(judgeAuditable(full({ deps: { status: 'unavailable' } }), { droppedArtifacts: 0, sentArtifacts: 3 }).auditable).toBe(false)
  })

  it('deps 집계가 아예 없으면 불능이다', () => {
    expect(judgeAuditable({ static: { requested: 1, scanned: 1 } }, { droppedArtifacts: 0, sentArtifacts: 3 }).auditable).toBe(false)
  })

  /**
   * artifact 가 드롭되면 Security 의 `requested` 가 그만큼 줄어
   * **"대상이 원래 없었다"와 구분되지 않는다.** `verify.ts` 가 이미 그것을 경고로만 남기고
   * "판정에는 쓰지 않는다(별도 슬라이스)"고 적어 뒀던 자리다 — 그 슬라이스가 이것이다.
   */
  it('artifact 가 드롭됐으면 집계를 믿을 수 없어 불능이다', () => {
    const v = judgeAuditable(full(), { droppedArtifacts: 2, sentArtifacts: 3 })
    expect(v.auditable).toBe(false)
    expect(v.auditable === false && v.reason).toMatch(/2/)
  })
})

/**
 * **드롭이 아니라 상대화다.** Security 의 인바운드 스키마는 상대경로만 받는데(전선 규칙),
 * Developer 는 절대경로를 낼 수 있다(`applyChange` 가 허용하고 자기 테스트도 그 형태다).
 * 드롭을 감사 불능으로 세면 **정상 산출물이 채널을 영구 차단**한다 — 전선 규칙을 판정에
 * 결합시킨 것이다. workspaceRoot 안이면 상대화해서 **감사 범위를 넓히는** 것이 맞다.
 */
describe('toAuditPath — workspaceRoot 기준 정규화', () => {
  const ws = '/abs/ws'

  it('상대경로는 그대로 통과시킨다', () => {
    expect(toAuditPath('src/a.ts', ws)).toBe('src/a.ts')
  })

  it('workspaceRoot 안의 절대경로는 상대화한다(드롭하지 않는다)', () => {
    expect(toAuditPath('/abs/ws/src/a.ts', ws)).toBe('src/a.ts')
  })

  it('구분자를 슬래시로 정규화한다(Security 스키마 호환)', () => {
    expect(toAuditPath('/abs/ws/src/nested/b.ts', ws)).toBe('src/nested/b.ts')
  })

  it('workspaceRoot 밖 절대경로는 감사할 수 없다', () => {
    expect(toAuditPath('/etc/passwd', ws)).toBeNull()
  })

  it('traversal 은 감사할 수 없다', () => {
    expect(toAuditPath('../outside/a.ts', ws)).toBeNull()
    expect(toAuditPath('src/../../a.ts', ws)).toBeNull()
  })

  it('workspaceRoot 자기 자신은 감사 대상이 아니다', () => {
    expect(toAuditPath('/abs/ws', ws)).toBeNull()
  })
})

describe('judgeAuditable — 집계 수치 위생', () => {
  it.each([
    [{ requested: -3, scanned: 0 }, '음수 requested 가 0-스캔 검사를 우회한다'],
    [{ requested: 1.5, scanned: 1 }, '정수가 아니다'],
    [{ requested: 1, scanned: -1 }, '음수 scanned'],
    [{ requested: 1, scanned: 99 }, 'scanned 가 requested 를 초과한다'],
  ])('비정상 집계 %o 는 불능이다 — %s', (stat) => {
    expect(judgeAuditable({ static: stat, deps: { status: 'ok' } }, { droppedArtifacts: 0, sentArtifacts: 1 }).auditable)
      .toBe(false)
  })

  it('보낸 파일이 있는데 요청이 0건이면 불능이다(집계가 실제와 어긋난다)', () => {
    const v = judgeAuditable(
      { static: { requested: 0, scanned: 0 }, deps: { status: 'ok' } },
      { droppedArtifacts: 0, sentArtifacts: 5 },
    )
    expect(v.auditable).toBe(false)
    expect(v.auditable === false && v.reason).toMatch(/5/)
  })

  it('보낸 파일이 0건이면 요청 0건은 정상이다', () => {
    expect(judgeAuditable(
      { static: { requested: 0, scanned: 0 }, deps: { status: 'ok' } },
      { droppedArtifacts: 0, sentArtifacts: 0 },
    )).toEqual({ auditable: true })
  })
})
