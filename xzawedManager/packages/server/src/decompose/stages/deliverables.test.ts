import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { deriveDeliverables } from './deliverables.js'
import type { StageDeps } from './run-stage.js'

function deps(text: string): StageDeps {
  return {
    claude: { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } } as ClaudeLike,
    model: 'm', timeoutMs: 1000,
  }
}

describe('deriveDeliverables', () => {
  it('정상 JSON → string[]', async () => {
    const out = await deriveDeliverables('build', deps('{"deliverables":["d1","d2"]}'))
    expect(out).toEqual(['d1', 'd2'])
  })

  it('중복·빈 항목 제거(입력순 보존)', async () => {
    const out = await deriveDeliverables('build', deps('{"deliverables":["d1","d1","","d2"]}'))
    expect(out).toEqual(['d1', 'd2'])
  })

  it('파싱 실패 → 빈 인벤토리', async () => {
    const out = await deriveDeliverables('build', deps('garbage'))
    expect(out).toEqual([])
  })
})
