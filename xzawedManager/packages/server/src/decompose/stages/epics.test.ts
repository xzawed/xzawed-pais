import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { identifyEpics } from './epics.js'
import type { StageDeps } from './run-stage.js'

function deps(text: string): StageDeps {
  return {
    claude: { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } } as ClaudeLike,
    model: 'm', timeoutMs: 1000,
  }
}

describe('identifyEpics', () => {
  it('정상 JSON → Epic[]', async () => {
    const out = await identifyEpics('build app', deps('{"epics":[{"epicRef":"e1","title":"Auth"},{"epicRef":"e2","title":"Billing"}]}'))
    expect(out).toEqual([{ epicRef: 'e1', title: 'Auth' }, { epicRef: 'e2', title: 'Billing' }])
  })

  it('파싱 실패 → intent 단일 epic으로 degrade', async () => {
    const out = await identifyEpics('build app', deps('garbage'))
    expect(out).toEqual([{ epicRef: 'epic-1', title: 'build app' }])
  })

  it('빈 epics → intent 단일 epic으로 degrade', async () => {
    const out = await identifyEpics('build app', deps('{"epics":[]}'))
    expect(out).toEqual([{ epicRef: 'epic-1', title: 'build app' }])
  })
})
