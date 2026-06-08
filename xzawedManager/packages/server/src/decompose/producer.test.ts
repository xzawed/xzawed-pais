import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { produceDecomposition, DECOMPOSE_STREAM, type ProduceDeps } from './producer.js'

/** 4단계 순서(epics→slice→deliverables→roles)대로 응답하는 mock claude. */
function stagedClaude(...texts: string[]): ClaudeLike {
  const create = vi.fn()
  for (const t of texts) create.mockResolvedValueOnce({ content: [{ type: 'text', text: t }] })
  return { messages: { create } }
}
function deps(claude: ClaudeLike, publish: ProduceDeps['publish']): ProduceDeps {
  return { claude, model: 'test-model', publish, timeoutMs: 1000, now: () => 1000 }
}

const EPICS = '{"epics":[{"epicRef":"e1","title":"Auth"}]}'
const STORIES = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"Login","deliverableIds":["d1"],"acceptanceCriteria":["x"]}]}'
const DELIVS = '{"deliverables":["d1"]}'
const ROLES = '{"assignments":[{"storyId":"s1","roles":["developer","designer"]}]}'

describe('produceDecomposition', () => {
  it('4단계 정상 → decomposition.emitted를 올바른 스트림/스키마로 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const res = await produceDecomposition('build a thing', 'wf-1', deps(stagedClaude(EPICS, STORIES, DELIVS, ROLES), publish))

    expect(res.emitted).toBe(2) // s1×developer, s1×designer
    expect(publish).toHaveBeenCalledTimes(1)
    const [stream, msg] = publish.mock.calls[0]!
    expect(stream).toBe(DECOMPOSE_STREAM)
    expect(msg.type).toBe('decomposition.emitted')
    expect(msg.envelope.workflowId).toBe('wf-1')
    expect(msg.envelope.stepId).toBe('decomposition.emitted')
    expect(msg.envelope.occurredAt).toBe(1000)
    expect(msg.payload.workPackages).toHaveLength(2)
    expect(msg.payload.workPackages[0].id).toMatch(/^wp_[0-9a-f]{32}$/)
  })

  it('전 단계 파싱 실패 시 fallback 단일 WP 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const res = await produceDecomposition('do X', 'wf-2', deps(stagedClaude('no', 'no', 'no', 'no'), publish))
    expect(res.emitted).toBe(1)
    const msg = publish.mock.calls[0]![1]
    expect(msg.payload.workPackages[0].acceptanceCriteria).toEqual(['do X'])
  })

  it('Claude 호출이 throw해도 fallback 발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const claude: ClaudeLike = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
    const res = await produceDecomposition('do Z', 'wf-4', deps(claude, publish))
    expect(res.emitted).toBe(1)
    const msg = publish.mock.calls[0]![1]
    expect(msg.payload.workPackages[0].acceptanceCriteria).toEqual(['do Z'])
  })
})
