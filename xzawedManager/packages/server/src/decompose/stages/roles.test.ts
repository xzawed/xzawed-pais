import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { assignRoles } from './roles.js'
import type { Story } from './slice.js'
import type { StageDeps } from './run-stage.js'

function deps(text: string): StageDeps {
  return {
    claude: { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } } as ClaudeLike,
    model: 'm', timeoutMs: 1000,
  }
}
function story(id: string): Story {
  return { storyId: id, epicRef: 'e1', title: id, deliverableIds: [], acceptanceCriteria: [] }
}

describe('assignRoles', () => {
  it('정상 JSON → storyId별 역할 Map(중복 제거)', async () => {
    const text = '{"assignments":[{"storyId":"s1","roles":["developer","developer","tester"]}]}'
    const out = await assignRoles([story('s1')], deps(text))
    expect(out.get('s1')).toEqual(['developer', 'tester'])
  })

  it('누락 story는 기본 역할 보정', async () => {
    const out = await assignRoles([story('s1'), story('s2')], deps('{"assignments":[{"storyId":"s1","roles":["designer"]}]}'))
    expect(out.get('s1')).toEqual(['designer'])
    expect(out.get('s2')).toEqual(['developer'])
  })

  it('파싱 실패 → 모든 story 기본 역할', async () => {
    const out = await assignRoles([story('s1'), story('s2')], deps('garbage'))
    expect(out.get('s1')).toEqual(['developer'])
    expect(out.get('s2')).toEqual(['developer'])
  })
})
