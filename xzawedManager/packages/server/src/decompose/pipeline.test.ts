import { describe, it, expect, vi } from 'vitest'
import { buildTaskGraph, readyNodes } from '@xzawed/agent-streams'
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
    expect(res.singleRoleStoryIds).toEqual(['s1']) // ROLES가 s1에 단일 역할만 부여 → 린트 신호
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

  it('repairMax=1 → 1회 repair 후 미수렴이면 inconsistent (루프 상한 증명)', async () => {
    const res = await runDecomposition('build', stagedDeps(EPICS, STORY_D1, DELIVS_GAP, 'garbage'), 1)
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

const STORIES_2 = '{"stories":[{"storyId":"s1","epicRef":"e1","title":"A","deliverableIds":["d1"],"acceptanceCriteria":["a"]},{"storyId":"s2","epicRef":"e1","title":"B","deliverableIds":["d2"],"acceptanceCriteria":["b"]}]}'
const DELIVS_2 = '{"deliverables":["d1","d2"]}'
const ROLES_2 = '{"assignments":[{"storyId":"s1","roles":["developer"]},{"storyId":"s2","roles":["developer"]}]}'
const EDGES_S2_S1 = '{"dependencies":[{"storyId":"s2","dependsOn":["s1"]}]}'

describe('runDecomposition 간선 추론·epicId (P6/P7)', () => {
  it('다중 story → 선행 story WP에 의존 + epicId 전파, FLAT 아님', async () => {
    // 순서: epics → slice(2 story) → deliverables → roles → infer-edges(2 story라 LLM 호출).
    const res = await runDecomposition('build', stagedDeps(EPICS, STORIES_2, DELIVS_2, ROLES_2, EDGES_S2_S1))
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.workPackages).toHaveLength(2)
    // 파이프라인은 story 순서로 WP 생성(s1 먼저). 결정론적이라 인덱스로 안전 접근(`!` 단언 회피).
    const [s1wp, s2wp] = res.workPackages
    expect(s1wp?.storyId).toBe('s1')
    expect(s2wp?.storyId).toBe('s2')
    expect(s1wp?.dependencies).toEqual([])           // root(선행 없음)
    expect(s2wp?.dependencies).toEqual([s1wp?.id])   // s2 → s1 (간선)
    expect(s1wp?.epicId).toBe('e1')                  // §7 epicId
    expect(s2wp?.epicId).toBe('e1')
    const graph = buildTaskGraph(res.workPackages)
    // 간선이 생겨 s2는 s1 완료 전 미ready(FLAT이면 둘 다 ready였음). 오라클 검사는 격리.
    expect(readyNodes(graph, { oracleSatisfied: () => true })).toEqual([s1wp?.id])
  })

  it('단일 story는 infer-edges LLM 미호출(추가 응답 불필요·간선 없음)', async () => {
    // STORY_D1 = 단일 story. infer-edges는 stories<2라 LLM 미호출 → 4응답으로 충분.
    const res = await runDecomposition('build', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES))
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.workPackages[0]?.dependencies).toEqual([])
    expect(res.workPackages[0]?.epicId).toBe('e1')   // 단일 story도 epicId는 전파
  })
})

const DRAFT_S1 = '{"scenarios":[{"title":"login ok","given":["g"],"when":"w","then":["t"],"coversCriteria":["x"]}]}'

describe('runDecomposition draftEnabled (P3-2)', () => {
  it('false면 oracleDrafts=[]', async () => {
    const r = await runDecomposition('i', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES), 2, false)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.oracleDrafts).toEqual([])
  })

  it('true면 story별 oracleDrafts 포함(oracleId 없음)', async () => {
    const r = await runDecomposition('i', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES, DRAFT_S1), 2, true)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.oracleDrafts.length).toBeGreaterThan(0)
    expect('oracleId' in r.oracleDrafts[0]!).toBe(false)
    expect(r.oracleDrafts[0]?.storyId).toBe('s1')
  })
})

const INV_S1 = '{"invariants":[{"statement":"bal>=0","domain":"acct","property":"forall, bal>=0"}]}'

describe('runDecomposition invariantsEnabled (F5)', () => {
  it('invariantsEnabled+draftEnabled면 oracleDrafts[].invariants 채움', async () => {
    const r = await runDecomposition('i', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES, DRAFT_S1, INV_S1), 2, true, true)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.oracleDrafts.length).toBeGreaterThan(0)
    expect(r.oracleDrafts[0]?.invariants[0]).toMatchObject({ id: 's1-inv1', statement: 'bal>=0', status: 'drafted' })
  })
  it('invariantsEnabled off면 invariants=[]', async () => {
    const r = await runDecomposition('i', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES, DRAFT_S1), 2, true, false)
    if (r.status !== 'ok') return
    expect(r.oracleDrafts[0]?.invariants).toEqual([])
  })
  it('draftEnabled off면 invariantsEnabled 무관 oracleDrafts=[](머지 skip)', async () => {
    const r = await runDecomposition('i', stagedDeps(EPICS, STORY_D1, DELIVS_D1, ROLES), 2, false, true)
    if (r.status !== 'ok') return
    expect(r.oracleDrafts).toEqual([])
  })
})
