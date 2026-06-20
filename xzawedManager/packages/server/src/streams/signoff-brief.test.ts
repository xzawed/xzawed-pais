import { describe, it, expect, vi } from 'vitest'
import { buildSignoffBrief, makeSignoffBrief } from './signoff-brief.js'

const INFO = {
  workflowId: 'wf-1', gateVersion: 'v-abc',
  blockingReasons: ['wp wp-a: 검증 증거 없음', 'wp wp-b: conformance fail'],
  perWp: [
    { wpId: 'wp-a', proven: false, unverifiable: true, missingChannels: [] },
    { wpId: 'wp-b', proven: false, unverifiable: false, missingChannels: ['conformance' as const] },
    { wpId: 'wp-c', proven: true, unverifiable: false, missingChannels: [] },
  ],
}

describe('buildSignoffBrief', () => {
  it('gate.blocked을 degraded_release DecisionRequest 입력으로 매핑', () => {
    const b = buildSignoffBrief(INFO, 'proj-1')
    expect(b.type).toBe('degraded_release')
    expect(b.requestId).toBe('wf-1:gate:v-abc')
    expect(b.wpId).toBeNull()
    expect(b.projectId).toBe('proj-1')
    expect(b.context?.impact).toEqual(['wp wp-a: 검증 증거 없음', 'wp wp-b: conformance fail'])
    expect(b.context?.evidenceRefs).toEqual(['wp-a', 'wp-b']) // un-proven WP만
    expect(b.context?.options).toEqual(['accept_known', 'reject'])
    expect(b.context?.expectedVsActual).toContain('2개 WP 미증명')
  })
  it('projectId 미지정 시 null', () => {
    expect(buildSignoffBrief(INFO).projectId).toBeNull()
  })
})

describe('makeSignoffBrief', () => {
  it('graphStore로 projectId 조회 후 createRequest', async () => {
    const createRequest = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const graphStore = { getGraph: vi.fn().mockResolvedValue({ userContext: { projectId: 'proj-1' } }) }
    await makeSignoffBrief({ createRequest }, graphStore)(INFO)
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({ type: 'degraded_release', projectId: 'proj-1', requestId: 'wf-1:gate:v-abc' }))
  })
  it('graphStore throw → projectId null(never-throw)·createRequest 진행', async () => {
    const createRequest = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const graphStore = { getGraph: vi.fn().mockRejectedValue(new Error('boom')) }
    await makeSignoffBrief({ createRequest }, graphStore)(INFO)
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
  })
})
