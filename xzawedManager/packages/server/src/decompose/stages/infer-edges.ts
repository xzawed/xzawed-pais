import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'
import type { Story } from './slice.js'

const EdgesSchema = z.object({
  dependencies: z
    .array(z.object({ storyId: z.string().min(1), dependsOn: z.array(z.string()).default([]) }))
    .default([]),
})

const MAX_TOKENS = 1024

export const INFER_EDGES_SYSTEM_PROMPT = `You infer DEPENDENCIES between vertical-slice stories — which stories must finish before another can start.

Return ONLY valid JSON:
{ "dependencies": [ { "storyId": "s2", "dependsOn": ["s1"] } ] }

- "dependsOn" lists the storyIds that MUST be done before this story (real ordering: data/contract/build).
- Omit stories that have no prerequisites. Do NOT invent storyIds. Do NOT create cycles. No prose.`

/**
 * §6 P6 `llm_infer_edges`: stories → storyId별 선행 story 의존. 단일 story는 LLM 미호출(간선 없음).
 * 실패·빈 결과면 빈 Map(FLAT degrade·회귀 0). 사이클은 build_dag 전에 결정론적으로 차단(아래 순수 함수).
 * story-level 추론만 — WP-level 간선은 pipeline이 선행 story의 WP들로 결정론 파생.
 */
export async function inferStoryDependencies(stories: Story[], deps: StageDeps): Promise<Map<string, string[]>> {
  if (stories.length < 2) return new Map() // 간선이 불가능 — LLM 호출·비용 회피
  const fallback = (): z.infer<typeof EdgesSchema> => ({ dependencies: [] })
  const user = `Stories:\n${stories.map((s) => `- ${s.storyId}: ${s.title}`).join('\n')}`
  const data = await runStage(deps, { system: INFER_EDGES_SYSTEM_PROMPT, user, maxTokens: MAX_TOKENS, schema: EdgesSchema, fallback })
  const raw = new Map<string, string[]>()
  for (const d of data.dependencies ?? []) raw.set(d.storyId, d.dependsOn ?? [])
  return acyclicStoryDependencies(stories.map((s) => s.storyId), raw)
}

/**
 * 순수: raw story 의존을 정제해 **비순환** Map 산출. 자기참조·미지 storyId 드롭, 사이클 유발 간선 드롭
 * (story 순서 + 정렬된 prereq로 결정론). "s depends on p" = 간선 s→p; p가 이미 s에 도달하면 추가 시 사이클 → skip.
 * 모든 storyId가 키로 존재(빈 prereq면 []). build_dag(buildTaskGraph)가 그대로 수용하는 DAG 보장.
 */
export function acyclicStoryDependencies(storyIds: string[], raw: Map<string, string[]>): Map<string, string[]> {
  const known = new Set(storyIds)
  const deps = new Map<string, string[]>()
  const canReach = (from: string, to: string): boolean => {
    const stack = [from]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n === to) return true
      if (seen.has(n)) continue
      seen.add(n)
      for (const p of deps.get(n) ?? []) stack.push(p)
    }
    return false
  }
  for (const s of storyIds) {
    const prereqs: string[] = []
    for (const p of [...new Set(raw.get(s) ?? [])].sort()) {
      if (p === s || !known.has(p)) continue // 자기참조·미지 드롭
      if (canReach(p, s)) continue // p가 s에 도달 → s→p 추가 시 사이클
      prereqs.push(p)
      deps.set(s, prereqs) // 후속 canReach가 즉시 반영하도록 갱신
    }
    if (!deps.has(s)) deps.set(s, [])
  }
  return deps
}
