import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike, CoverageMatrix } from '@xzawed/agent-streams'
import { repairStories } from './repair.js'
import type { Story } from './slice.js'
import type { StageDeps } from './run-stage.js'

function deps(text: string): StageDeps {
  return {
    claude: { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } } as ClaudeLike,
    model: 'm', timeoutMs: 1000,
  }
}
const story = (id: string, claims: string[]): Story => ({ storyId: id, epicRef: 'e1', title: id, deliverableIds: claims, acceptanceCriteria: ['x'] })
const coverage = (over: Partial<CoverageMatrix> = {}): CoverageMatrix => ({ gaps: [], overlaps: [], unknownClaims: [], ...over })

describe('repairStories', () => {
  it('정상 JSON → 수정 stories 반환', async () => {
    const revised = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"s1","deliverableIds":["d1","d2"],"acceptanceCriteria":["x"]}]}'
    const out = await repairStories([story('s1', ['d1'])], ['d1', 'd2'], coverage({ gaps: ['d2'] }), deps(revised))
    expect(out).toEqual([{ storyId: 's1', epicRef: 'e1', title: 's1', deliverableIds: ['d1', 'd2'], acceptanceCriteria: ['x'] }])
  })

  it('파싱 실패 → 입력 stories 그대로(개선 없음)', async () => {
    const input = [story('s1', ['d1'])]
    const out = await repairStories(input, ['d1', 'd2'], coverage({ gaps: ['d2'] }), deps('garbage'))
    expect(out).toEqual(input)
  })

  it('빈 stories 반환 → 입력 그대로', async () => {
    const input = [story('s1', ['d1'])]
    const out = await repairStories(input, ['d1'], coverage(), deps('{"stories":[]}'))
    expect(out).toEqual(input)
  })
})
