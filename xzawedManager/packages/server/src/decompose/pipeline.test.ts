import { describe, it, expect, vi } from 'vitest'
import { buildTaskGraph } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { runDecomposition, fallbackWorkPackages } from './pipeline.js'
import type { StageDeps } from './stages/run-stage.js'

/** 단계 순서(epics→slice→deliverables→[repair…]→roles)대로 응답하는 mock. */
function stagedDeps(...texts: string[]): StageDeps {
  const create = vi.fn()
  for (const t of texts) create.mockResolvedValueOnce({ content: [{ type: 'text', text: t }] })
  return { claude: { messages: { create } } as ClaudeLike, model: 'm', timeoutMs: 1000 }
}

const EPICS = '{"epics":[{"epicRef":"e1","title":"Auth"}]}'
const STORY_D1 = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"Login","deliverableIds":["d1"],"acceptanceCriteria":["x"]}]}'
const DELIVS_D1 = '{"deliverables":["d1"]}'
const DELIVS_GAP = '{"deliverables":["d1","d2"]}'
const REPAIR_D1D2 = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"Login","deliverableIds":["d1","d2"],"acceptanceCriteria":["x"]}]}'
const ROLES = '{"assignments":[{"storyId":"s1","roles":["developer"]}]}'

describe('runDecomposition (P2-3b)', () => {
  it('첫 수렴(repair 불필요) → status ok + 린트', async () => {
    const res = await runDecomposition('build', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES))
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.workPackages).toHaveLength(1)
    expect(res.coverage.gaps).toEqual([])
    expect(res.singleRoleStoryIds).toEqual(['s1'])
    expect(() => buildTaskGraph(res.workPackages)).not.toThrow()
  })

  it('repair 1회 후 수렴 → status ok', async () => {
    const res = await runDecomposition('build', stagedDeps(EPICS, STORY_D1, DELIVS_GAP, REPAIR_D1D2, ROLES))
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.coverage.gaps).toEqual([])
    expect(res.workPackages).toHaveLength(1)
  })

  it('K 소진 → status inconsistent (reason coverage)', async () => {
    const res = await runDecomposition('build', stagedDeps(EPICS, STORY_D1, DELIVS_GAP, 'garbage', 'garbage'), 2)
    expect(res.status).toBe('inconsistent')
    if (res.status !== 'inconsistent') return
    expect(res.reason).toBe('coverage')
    expect(res.coverage.gaps).toEqual(['d2'])
  })

  it('deliverables 빈 degrade → 수렴(에스컬레이션 아님) status ok', async () => {
    const res = await runDecomposition('do thing', stagedDeps('x', 'y', 'z', 'w'))
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.workPackages).toHaveLength(1)
    expect(res.workPackages[0]?.acceptanceCriteria).toEqual(['do thing'])
  })

  it('fallbackWorkPackages는 intent 단일 WP', () => {
    const out = fallbackWorkPackages('only this')
    expect(out).toHaveLength(1)
    expect(out[0]?.acceptanceCriteria).toEqual(['only this'])
  })
})
