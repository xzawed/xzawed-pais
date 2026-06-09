import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { draftOracles, MAX_SCENARIOS_PER_STORY } from './draft-oracles.js'
import type { Story } from './slice.js'

const mockClaude = (text: string): ClaudeLike => ({ messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } })
const deps = (claude: ClaudeLike) => ({ claude, model: 'm', timeoutMs: 1000 })
const story = (over: Partial<Story> = {}): Story => ({ storyId: over.storyId ?? 's1', epicRef: 'e1', title: over.title ?? 'S1', deliverableIds: [], acceptanceCriteria: over.acceptanceCriteria ?? ['ac1', 'ac2'] })

describe('draftOracles', () => {
  it('oracleId를 부여하지 않고 모든 AC를 덮음(scenarioId 결정론)', async () => {
    const text = JSON.stringify({ scenarios: [{ title: 'h', given: ['g'], when: 'w', then: ['t'], coversCriteria: ['ac1', 'ac2'] }] })
    const [d] = await draftOracles([story()], deps(mockClaude(text)))
    expect('oracleId' in d).toBe(false)
    expect(d.storyId).toBe('s1')
    expect(d.scenarios[0]).toMatchObject({ id: 's1-sc1', status: 'drafted', when: 'w' })
    expect(Object.keys(d.coverage).sort()).toEqual(['ac1', 'ac2'])
  })
  it('미커버 AC는 stub으로 보장', async () => {
    const [d] = await draftOracles([story()], deps(mockClaude(JSON.stringify({ scenarios: [{ title: 'a', coversCriteria: ['ac1'] }] }))))
    expect(d.coverage.ac2).toHaveLength(1)
    expect(d.scenarios.find((s) => s.id === d.coverage.ac2[0])).toMatchObject({ status: 'drafted', then: ['ac2'] })
  })
  it('LLM 실패 시 AC별 stub fallback', async () => {
    const claude: ClaudeLike = { messages: { create: vi.fn().mockRejectedValue(new Error('x')) } }
    const [d] = await draftOracles([story({ acceptanceCriteria: ['x', 'y'] })], deps(claude))
    expect(d.scenarios).toHaveLength(2)
  })
  it('story당 LLM 시나리오를 MAX_SCENARIOS_PER_STORY로 절단', async () => {
    const many = Array.from({ length: MAX_SCENARIOS_PER_STORY + 5 }, (_, i) => ({ title: `t${i}`, coversCriteria: ['ac1'] }))
    const [d] = await draftOracles([story({ acceptanceCriteria: ['ac1'] })], deps(mockClaude(JSON.stringify({ scenarios: many }))))
    expect(d.scenarios.length).toBeLessThanOrEqual(MAX_SCENARIOS_PER_STORY)
  })
})
