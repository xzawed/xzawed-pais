import { describe, it, expect, vi } from 'vitest'
import { buildDegradedDispatchBrief, makeDegradedDispatchBrief } from './degraded-signoff-brief.js'

describe('buildDegradedDispatchBrief', () => {
  it('per-WP degraded_dispatch DecisionRequest를 결정론 requestId로 만든다', () => {
    const out = buildDegradedDispatchBrief({ workflowId: 'wf-1', wpId: 'wp-a', stepN: 2, projectId: 'p-1' })
    expect(out.requestId).toBe('wf-1:degraded:wp-a')
    expect(out.type).toBe('degraded_dispatch')
    expect(out.workflowId).toBe('wf-1')
    expect(out.wpId).toBe('wp-a')
    expect(out.projectId).toBe('p-1')
    expect(out.context?.options).toEqual(['accept_known', 'reject'])
  })

  it('projectId 미지정이면 null', () => {
    const out = buildDegradedDispatchBrief({ workflowId: 'wf-1', wpId: 'wp-a', stepN: 0 })
    expect(out.projectId).toBeNull()
  })
})

describe('makeDegradedDispatchBrief', () => {
  it('createRequest로 브리프를 영속한다(ttl 없으면 expiresAt 미설정)', async () => {
    const createRequest = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const handler = makeDegradedDispatchBrief({ createRequest })
    await handler({ workflowId: 'wf-1', wpId: 'wp-a', stepN: 0, projectId: null })
    expect(createRequest).toHaveBeenCalledTimes(1)
    const arg = createRequest.mock.calls[0][0]
    expect(arg.requestId).toBe('wf-1:degraded:wp-a')
    expect(arg.expiresAt).toBeUndefined()
  })

  it('ttlMs 주입 시 expiresAt를 채운다', async () => {
    const createRequest = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const handler = makeDegradedDispatchBrief({ createRequest }, { now: () => 1000, ttlMs: 5000 })
    await handler({ workflowId: 'wf-1', wpId: 'wp-a', stepN: 0 })
    const arg = createRequest.mock.calls[0][0]
    expect(arg.expiresAt).toBe(new Date(6000).toISOString())
  })
})
