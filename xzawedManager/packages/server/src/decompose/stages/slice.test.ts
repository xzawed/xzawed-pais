import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { sliceVertical } from './slice.js'
import type { Epic } from './epics.js'
import type { StageDeps } from './run-stage.js'

function deps(text: string): StageDeps {
  return {
    claude: { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } } as ClaudeLike,
    model: 'm', timeoutMs: 1000,
  }
}
const epics: Epic[] = [{ epicRef: 'e1', title: 'Auth' }, { epicRef: 'e2', title: 'Billing' }]

describe('sliceVertical', () => {
  it('정상 JSON → Story[]', async () => {
    const text = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"Login","deliverableIds":["d1"],"acceptanceCriteria":["can log in"]}]}'
    const out = await sliceVertical(epics, 'intent', deps(text))
    expect(out).toEqual([
      { storyId: 's1', epicRef: 'e1', title: 'Login', deliverableIds: ['d1'], acceptanceCriteria: ['can log in'] },
    ])
  })

  it('파싱 실패 → 각 epic을 단일 story로 degrade(claims 빈·AC=epic.title)', async () => {
    const out = await sliceVertical(epics, 'intent', deps('garbage'))
    expect(out).toEqual([
      { storyId: 'story-1', epicRef: 'e1', title: 'Auth', deliverableIds: [], acceptanceCriteria: ['Auth'] },
      { storyId: 'story-2', epicRef: 'e2', title: 'Billing', deliverableIds: [], acceptanceCriteria: ['Billing'] },
    ])
  })

  it('빈 stories → degrade', async () => {
    const out = await sliceVertical(epics, 'intent', deps('{"stories":[]}'))
    expect(out).toHaveLength(2)
    expect(out[0]?.storyId).toBe('story-1')
  })
})
