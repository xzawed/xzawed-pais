import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { draftInvariants, MAX_INVARIANTS_PER_STORY } from './draft-invariants.js'
import type { Story } from './slice.js'

const mockClaude = (text: string): ClaudeLike => ({ messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } })
const deps = (claude: ClaudeLike) => ({ claude, model: 'm', timeoutMs: 1000 })
const story = (over: Partial<Story> = {}): Story => ({ storyId: over.storyId ?? 's1', epicRef: 'e1', title: over.title ?? 'S1', deliverableIds: [], acceptanceCriteria: over.acceptanceCriteria ?? ['ac1'] })

describe('draftInvariants', () => {
  it('LLM invariants를 결정론 id·status:drafted로 매핑', async () => {
    const text = JSON.stringify({ invariants: [{ statement: 'balance >= 0', domain: 'account', property: 'forall w, bal>=0' }] })
    const m = await draftInvariants([story()], deps(mockClaude(text)))
    const invs = m.get('s1')!
    expect(invs).toHaveLength(1)
    expect(invs[0]).toMatchObject({ id: 's1-inv1', statement: 'balance >= 0', domain: 'account', property: 'forall w, bal>=0', status: 'drafted' })
  })
  it('빈 statement 항목은 드롭(저품질 가드)', async () => {
    const text = JSON.stringify({ invariants: [{ statement: '  ' }, { statement: 'real one' }] })
    const invs = (await draftInvariants([story()], deps(mockClaude(text)))).get('s1')!
    expect(invs).toHaveLength(1)
    expect(invs[0].statement).toBe('real one')
  })
  it('LLM이 빈 배열이면 빈(stub 강제 안 함)', async () => {
    const invs = (await draftInvariants([story()], deps(mockClaude('{"invariants":[]}')))).get('s1')!
    expect(invs).toEqual([])
  })
  it('LLM 실패면 빈(never-throw·분해 비차단)', async () => {
    const claude: ClaudeLike = { messages: { create: vi.fn().mockRejectedValue(new Error('x')) } }
    const invs = (await draftInvariants([story()], deps(claude))).get('s1')!
    expect(invs).toEqual([])
  })
  it('MAX_INVARIANTS_PER_STORY로 절단', async () => {
    const many = Array.from({ length: MAX_INVARIANTS_PER_STORY + 4 }, (_, i) => ({ statement: `inv${i}` }))
    const invs = (await draftInvariants([story()], deps(mockClaude(JSON.stringify({ invariants: many }))))).get('s1')!
    expect(invs.length).toBeLessThanOrEqual(MAX_INVARIANTS_PER_STORY)
  })
  it('여러 story를 각각 매핑(id는 storyId 기준)', async () => {
    const text = JSON.stringify({ invariants: [{ statement: 'inv' }] })
    const m = await draftInvariants([story({ storyId: 's1' }), story({ storyId: 's2' })], deps(mockClaude(text)))
    expect(m.get('s1')?.[0].id).toBe('s1-inv1')
    expect(m.get('s2')?.[0].id).toBe('s2-inv1')
  })
})
