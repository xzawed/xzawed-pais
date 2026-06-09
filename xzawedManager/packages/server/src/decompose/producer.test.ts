import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { produceDecomposition, DECOMPOSE_STREAM, type ProduceDeps } from './producer.js'

/** 단계 순서대로 응답하는 mock claude. */
function stagedClaude(...texts: string[]): ClaudeLike {
  const create = vi.fn()
  for (const t of texts) create.mockResolvedValueOnce({ content: [{ type: 'text', text: t }] })
  return { messages: { create } }
}
function deps(claude: ClaudeLike, publish: ProduceDeps['publish']): ProduceDeps {
  return { claude, model: 'test-model', publish, timeoutMs: 1000, repairMax: 2, now: () => 1000 }
}

const EPICS = '{"epics":[{"epicRef":"e1","title":"Auth"}]}'
const STORY_D1 = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"Login","deliverableIds":["d1"],"acceptanceCriteria":["x"]}]}'
const DELIVS_D1 = '{"deliverables":["d1"]}'
const DELIVS_GAP = '{"deliverables":["d1","d2"]}'
const ROLES = '{"assignments":[{"storyId":"s1","roles":["developer","designer"]}]}'

describe('produceDecomposition (P2-3b)', () => {
  it('수렴 → decomposition.emitted 발행(escalated false)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const logSpy = vi.fn()
    const res = await produceDecomposition('build a thing', 'wf-1', { ...deps(stagedClaude(EPICS, STORY_D1, DELIVS_D1, ROLES), publish), log: logSpy })

    expect(res.escalated).toBe(false)
    expect(res.emitted).toBe(2) // s1×developer, s1×designer
    const [stream, msg] = publish.mock.calls[0]!
    expect(stream).toBe(DECOMPOSE_STREAM)
    expect(msg.type).toBe('decomposition.emitted')
    expect(msg.envelope.stepId).toBe('decomposition.emitted')
    expect(msg.payload.workPackages).toHaveLength(2)
    expect(msg.payload).not.toHaveProperty('coverage')
    expect(logSpy).toHaveBeenCalledWith('[decompose] coverage', expect.objectContaining({ gaps: 0 }))
  })

  it('repair 소진 → decomposition.inconsistent 발행·WP 미발행', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const logSpy = vi.fn()
    const res = await produceDecomposition('build', 'wf-5', { ...deps(stagedClaude(EPICS, STORY_D1, DELIVS_GAP, 'garbage', 'garbage'), publish), log: logSpy })

    expect(res.escalated).toBe(true)
    expect(res.emitted).toBe(0)
    expect(publish).toHaveBeenCalledTimes(1)
    const [stream, msg] = publish.mock.calls[0]!
    expect(stream).toBe('manager:events:wf-5')
    expect(msg.type).toBe('decomposition.inconsistent')
    expect(msg.envelope.stepId).toBe('decomposition.inconsistent')
    expect(msg.payload.reason).toBe('coverage')
    expect(msg.payload.gaps).toEqual(['d2'])
    expect(logSpy).toHaveBeenCalledWith('[decompose] coverage unresolved — escalating', expect.objectContaining({ gaps: 1 }))
  })

  it('전 단계 파싱 실패 시 fallback 단일 WP 발행(escalated false)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const res = await produceDecomposition('do X', 'wf-2', deps(stagedClaude('no', 'no', 'no', 'no'), publish))
    expect(res.escalated).toBe(false)
    expect(res.emitted).toBe(1)
    const msg = publish.mock.calls[0]![1]
    expect(msg.type).toBe('decomposition.emitted')
    expect(msg.payload.workPackages[0].acceptanceCriteria).toEqual(['do X'])
  })

  it('Claude 호출이 throw해도 fallback 발행(escalated false)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    const claude: ClaudeLike = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
    const res = await produceDecomposition('do Z', 'wf-4', deps(claude, publish))
    expect(res.escalated).toBe(false)
    expect(res.emitted).toBe(1)
    const msg = publish.mock.calls[0]![1]
    expect(msg.type).toBe('decomposition.emitted')
    expect(msg.payload.workPackages[0].acceptanceCriteria).toEqual(['do Z'])
  })
})
