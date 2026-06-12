import { describe, test, expect } from 'vitest'
import {
  AdvisoryFindingSchema, AdvisoryFindingsResultSchema,
  ADVISORY_FOUND_EVENT, ADVISORY_STREAM, ADVISORY_ACTOR, MAX_ADVISORY_FINDINGS,
} from './advisory.types.js'

describe('advisory.types', () => {
  test('AdvisoryFinding은 rank/title/rationale + severity/sourceLens const를 검증한다', () => {
    const ok = AdvisoryFindingSchema.safeParse({
      rank: 1, title: 'memoize hot path', rationale: '비용↓ 효과 큰 N+1 제거', severity: 'advisory', sourceLens: 'optimization',
    })
    expect(ok.success).toBe(true)
    // severity가 'blocking'이면 거부(N3 타입 표식)
    expect(AdvisoryFindingSchema.safeParse({
      rank: 1, title: 't', rationale: 'r', severity: 'blocking', sourceLens: 'optimization',
    }).success).toBe(false)
  })

  test('AdvisoryFindingsResult은 LLM 출력 {findings:[{title,rationale}]}을 파싱하고, 누락/부재는 거부(→runStage fallback)', () => {
    const ok = AdvisoryFindingsResultSchema.safeParse({ findings: [{ title: 't', rationale: 'r' }] })
    expect(ok.success).toBe(true)
    expect(AdvisoryFindingsResultSchema.safeParse({ findings: [] }).success).toBe(true) // 빈 배열 유효(no-op)
    expect(AdvisoryFindingsResultSchema.safeParse({}).success).toBe(false) // findings 키 부재
    expect(AdvisoryFindingsResultSchema.safeParse({ findings: [{ title: 't' }] }).success).toBe(false) // rationale 누락
  })

  test('상수 단일출처', () => {
    expect(ADVISORY_FOUND_EVENT).toBe('wp.advisory.found')
    expect(ADVISORY_STREAM).toBe('manager:advisory:main')
    expect(ADVISORY_ACTOR).toBe('advisory-lens')
    expect(MAX_ADVISORY_FINDINGS).toBe(8)
  })
})
