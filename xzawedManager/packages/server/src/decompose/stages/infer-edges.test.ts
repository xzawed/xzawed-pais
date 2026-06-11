import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { inferStoryDependencies, acyclicStoryDependencies } from './infer-edges.js'
import type { Story } from './slice.js'
import type { StageDeps } from './run-stage.js'

function story(id: string, title = id): Story {
  return { storyId: id, epicRef: 'e1', title, deliverableIds: [], acceptanceCriteria: ['ac'] }
}
function depsFrom(text?: string): StageDeps {
  const create = vi.fn()
  if (text !== undefined) create.mockResolvedValueOnce({ content: [{ type: 'text', text }] })
  return { claude: { messages: { create } } as ClaudeLike, model: 'm', timeoutMs: 1000 }
}

describe('acyclicStoryDependencies (순수·결정론 비순환 정제)', () => {
  it('정상 선행 의존을 보존', () => {
    const out = acyclicStoryDependencies(['s1', 's2'], new Map([['s2', ['s1']]]))
    expect(out.get('s2')).toEqual(['s1'])
    expect(out.get('s1')).toEqual([])
  })

  it('자기참조 드롭', () => {
    expect(acyclicStoryDependencies(['s1'], new Map([['s1', ['s1']]])).get('s1')).toEqual([])
  })

  it('미지 storyId 의존 드롭(dangling 방지)', () => {
    expect(acyclicStoryDependencies(['s1', 's2'], new Map([['s2', ['ghost']]])).get('s2')).toEqual([])
  })

  it('사이클 유발 간선을 결정론적으로 드롭(나머지 보존·DAG 보장)', () => {
    // s1↔s2 상호 의존: story 순서로 s1→s2를 먼저 추가, s2→s1은 사이클이라 드롭.
    const out = acyclicStoryDependencies(['s1', 's2'], new Map([['s1', ['s2']], ['s2', ['s1']]]))
    expect(out.get('s1')).toEqual(['s2'])
    expect(out.get('s2')).toEqual([])
  })

  it('prereq 중복 제거 + 정렬(결정론)', () => {
    const out = acyclicStoryDependencies(['s1', 's2', 's3'], new Map([['s3', ['s2', 's1', 's2']]]))
    expect(out.get('s3')).toEqual(['s1', 's2'])
  })

  it('3-노드 사이클도 차단(s1→s2→s3→s1에서 마지막 간선 드롭)', () => {
    const out = acyclicStoryDependencies(['s1', 's2', 's3'], new Map([['s1', ['s2']], ['s2', ['s3']], ['s3', ['s1']]]))
    // s3→s1 추가 시 s1→s2→s3 경로로 s1이 s3에 도달 → 사이클 → 드롭.
    expect(out.get('s3')).toEqual([])
    expect(out.get('s1')).toEqual(['s2'])
    expect(out.get('s2')).toEqual(['s3'])
  })
})

describe('inferStoryDependencies (P6 llm_infer_edges)', () => {
  it('단일 story는 LLM 미호출·빈 Map(간선 없음)', async () => {
    const d = depsFrom()
    const out = await inferStoryDependencies([story('s1')], d)
    expect(out.size).toBe(0)
    expect((d.claude.messages.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('LLM 의존을 비순환 정제 Map으로 반환', async () => {
    const out = await inferStoryDependencies(
      [story('s1'), story('s2')],
      depsFrom('{"dependencies":[{"storyId":"s2","dependsOn":["s1"]}]}'),
    )
    expect(out.get('s2')).toEqual(['s1'])
    expect(out.get('s1')).toEqual([])
  })

  it('LLM 실패(garbage)면 빈 Map(FLAT degrade)', async () => {
    const out = await inferStoryDependencies([story('s1'), story('s2')], depsFrom('not json'))
    expect(out.get('s1')).toEqual([])
    expect(out.get('s2')).toEqual([])
  })
})
