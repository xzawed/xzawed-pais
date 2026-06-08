import { describe, it, expect } from 'vitest'
import { coverageMatrix } from '../decomposition/index.js'

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
})
