import { describe, it, expect, vi } from 'vitest'
import { buildTaskGraph } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { runDecomposition, fallbackWorkPackages } from './pipeline.js'
import type { StageDeps } from './stages/run-stage.js'

/** 4단계 순서(epics→slice→deliverables→roles)대로 응답을 주는 mock. */
function stagedDeps(...texts: string[]): StageDeps {
  const create = vi.fn()
  for (const t of texts) create.mockResolvedValueOnce({ content: [{ type: 'text', text: t }] })
  return { claude: { messages: { create } } as ClaudeLike, model: 'm', timeoutMs: 1000 }
}

const EPICS = '{"epics":[{"epicRef":"e1","title":"Auth"}]}'
const STORIES = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"Login","deliverableIds":["d1"],"acceptanceCriteria":["x"]}]}'
const DELIVS = '{"deliverables":["d1","d2"]}'
const ROLES = '{"assignments":[{"storyId":"s1","roles":["developer","tester"]}]}'

describe('runDecomposition', () => {
  it('4단계 정상 → story×role 전개 WP[] + coverage', async () => {
    const { workPackages, coverage } = await runDecomposition('build', stagedDeps(EPICS, STORIES, DELIVS, ROLES))
    expect(workPackages).toHaveLength(2) // s1×developer, s1×tester
    expect(workPackages.every((w) => w.id.startsWith('wp_'))).toBe(true)
    expect(workPackages.every((w) => w.dependencies.length === 0)).toBe(true) // flat (간선 없음)
    expect(coverage.gaps).toEqual(['d2']) // d2는 어느 story도 미주장
    expect(coverage.overlaps).toEqual([])
    expect(coverage.unknownClaims).toEqual([])
    expect(() => buildTaskGraph(workPackages)).not.toThrow()
  })

  it('전 단계 실패 → degrade로 단일 WP·빈 emit 없음', async () => {
    const { workPackages } = await runDecomposition('do thing', stagedDeps('x', 'y', 'z', 'w'))
    expect(workPackages).toHaveLength(1)
    expect(workPackages[0]?.acceptanceCriteria).toEqual(['do thing'])
  })

  it('fallbackWorkPackages는 intent 단일 WP', () => {
    const out = fallbackWorkPackages('only this')
    expect(out).toHaveLength(1)
    expect(out[0]?.acceptanceCriteria).toEqual(['only this'])
  })
})
