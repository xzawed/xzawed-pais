import { describe, it, expect } from 'vitest'
import { coverageMatrix, contentHashId } from '../decomposition/index.js'

describe('coverageMatrix', () => {
  it('완전 커버면 갭·중복·unknown 모두 빈 배열', () => {
    const m = coverageMatrix(
      [
        { storyId: 's1', deliverableIds: ['d1', 'd2'] },
        { storyId: 's2', deliverableIds: ['d3'] },
      ],
      ['d1', 'd2', 'd3'],
    )
    expect(m).toEqual({ gaps: [], overlaps: [], unknownClaims: [] })
  })

  it('어느 스토리도 안 덮는 산출물을 gap으로 보고(id 정렬)', () => {
    const m = coverageMatrix([{ storyId: 's1', deliverableIds: ['d2'] }], ['d3', 'd1', 'd2'])
    expect(m.gaps).toEqual(['d1', 'd3'])
    expect(m.overlaps).toEqual([])
  })

  it('2개 이상 스토리가 덮는 산출물을 overlap으로 보고(storyIds 정렬)', () => {
    const m = coverageMatrix(
      [
        { storyId: 's2', deliverableIds: ['d1'] },
        { storyId: 's1', deliverableIds: ['d1'] },
      ],
      ['d1'],
    )
    expect(m.overlaps).toEqual([{ deliverableId: 'd1', storyIds: ['s1', 's2'] }])
    expect(m.gaps).toEqual([])
  })

  it('인벤토리에 없는 산출물 주장을 unknownClaims로 보고', () => {
    const m = coverageMatrix([{ storyId: 's1', deliverableIds: ['dX'] }], ['d1'])
    expect(m.unknownClaims).toEqual([{ storyId: 's1', deliverableId: 'dX' }])
    expect(m.gaps).toEqual(['d1'])
  })

  it('같은 스토리가 같은 산출물을 중복 나열해도 1회로 계수(overlap 아님)', () => {
    const m = coverageMatrix([{ storyId: 's1', deliverableIds: ['d1', 'd1'] }], ['d1'])
    expect(m.overlaps).toEqual([])
    expect(m.gaps).toEqual([])
  })

  it('빈 stories면 모든 산출물이 gap', () => {
    const m = coverageMatrix([], ['d1', 'd2'])
    expect(m.gaps).toEqual(['d1', 'd2'])
  })

  it('입력 순서가 달라도 같은 결과(결정론)', () => {
    const a = coverageMatrix(
      [
        { storyId: 's1', deliverableIds: ['d1'] },
        { storyId: 's2', deliverableIds: ['d1'] },
      ],
      ['d2', 'd1'],
    )
    const b = coverageMatrix(
      [
        { storyId: 's2', deliverableIds: ['d1'] },
        { storyId: 's1', deliverableIds: ['d1'] },
      ],
      ['d1', 'd2'],
    )
    expect(a).toEqual(b)
  })

  it('인벤토리에 중복 id가 있어도 1회로 계수(gap 중복 없음)', () => {
    const m = coverageMatrix([], ['d1', 'd1', 'd2'])
    expect(m.gaps).toEqual(['d1', 'd2'])
  })

  it('한 스토리가 known·unknown 산출물을 함께 주장하면 각각 분류', () => {
    const m = coverageMatrix([{ storyId: 's1', deliverableIds: ['d1', 'dX'] }], ['d1'])
    expect(m.gaps).toEqual([])
    expect(m.unknownClaims).toEqual([{ storyId: 's1', deliverableId: 'dX' }])
  })

  it('unknownClaims는 storyId 우선·deliverableId 차선으로 정렬', () => {
    const m = coverageMatrix(
      [
        { storyId: 's2', deliverableIds: ['dY'] },
        { storyId: 's1', deliverableIds: ['dX'] },
      ],
      [],
    )
    expect(m.unknownClaims).toEqual([
      { storyId: 's1', deliverableId: 'dX' },
      { storyId: 's2', deliverableId: 'dY' },
    ])
  })
})

describe('contentHashId', () => {
  const base = { storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['a', 'b'] }

  it('wp_ 접두 + hex 32자 형식', () => {
    const id = contentHashId(base)
    expect(id).toMatch(/^wp_[0-9a-f]{32}$/)
  })

  it('acceptanceCriteria 순서가 달라도 같은 id', () => {
    const id1 = contentHashId({ ...base, acceptanceCriteria: ['a', 'b'] })
    const id2 = contentHashId({ ...base, acceptanceCriteria: ['b', 'a'] })
    expect(id1).toBe(id2)
  })

  it('같은 입력 반복 시 같은 id(결정론)', () => {
    expect(contentHashId(base)).toBe(contentHashId({ ...base }))
  })

  it('storyId 또는 owningRole이 다르면 다른 id', () => {
    expect(contentHashId(base)).not.toBe(contentHashId({ ...base, storyId: 's2' }))
    expect(contentHashId(base)).not.toBe(contentHashId({ ...base, owningRole: 'designer' }))
  })

  it('acceptanceCriteria 내용이 다르면 다른 id', () => {
    expect(contentHashId(base)).not.toBe(contentHashId({ ...base, acceptanceCriteria: ['a', 'c'] }))
  })

  it('빈 acceptanceCriteria 허용', () => {
    expect(contentHashId({ ...base, acceptanceCriteria: [] })).toMatch(/^wp_[0-9a-f]{32}$/)
  })

  it('acceptanceCriteria 중복 항목은 제거하지 않음(중복 포함 시 다른 id)', () => {
    const withDup = contentHashId({ ...base, acceptanceCriteria: ['a', 'a'] })
    const withoutDup = contentHashId({ ...base, acceptanceCriteria: ['a'] })
    expect(withDup).not.toBe(withoutDup)
  })
})
