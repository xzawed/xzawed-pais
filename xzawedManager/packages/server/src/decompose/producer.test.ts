import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { produceDecomposition, DECOMPOSE_STREAM, type ProduceDeps } from './producer.js'

function mockClaude(text: string): ClaudeLike {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } }
}

function deps(claude: ClaudeLike, publish: ProduceDeps['publish']): ProduceDeps {
  return { claude, model: 'test-model', publish, now: () => 1000 }
}

describe('produceDecomposition', () => {
  it('정상 LLM JSON → decomposition.emitted를 올바른 스트림/스키마로 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const json = JSON.stringify({
      workPackages: [
        { ref: 'a', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['x'], dependsOn: [] },
        { ref: 'b', storyId: 's2', owningRole: 'designer', acceptanceCriteria: ['y'], dependsOn: ['a'] },
      ],
    })
    const res = await produceDecomposition('build a thing', 'wf-1', deps(mockClaude(json), publish))

    expect(res.emitted).toBe(2)
    expect(publish).toHaveBeenCalledTimes(1)
    const [stream, msg] = publish.mock.calls[0]!
    expect(stream).toBe(DECOMPOSE_STREAM)
    expect(msg.type).toBe('decomposition.emitted')
    expect(msg.envelope.workflowId).toBe('wf-1')
    expect(msg.envelope.stepId).toBe('decomposition.emitted')
    expect(msg.envelope.occurredAt).toBe(1000)
    expect(msg.payload.workPackages).toHaveLength(2)
    expect(msg.payload.workPackages[1].dependencies).toEqual([msg.payload.workPackages[0].id])
  })

  it('LLM 파싱 실패 시 fallback 단일 WP를 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const res = await produceDecomposition('do X', 'wf-2', deps(mockClaude('not json at all'), publish))
    expect(res.emitted).toBe(1)
    const msg = publish.mock.calls[0]![1]
    expect(msg.payload.workPackages[0].acceptanceCriteria).toEqual(['do X'])
  })

  it('빈 workPackages면 fallback 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const res = await produceDecomposition('do Y', 'wf-3', deps(mockClaude('{"workPackages":[]}'), publish))
    expect(res.emitted).toBe(1)
  })

  it('Claude 호출이 throw해도 fallback 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const claude: ClaudeLike = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
    const res = await produceDecomposition('do Z', 'wf-4', deps(claude, publish))
    expect(res.emitted).toBe(1)
  })
})
