import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'
import type { Story } from './slice.js'
import type { OracleScenario, OracleDraft } from '../../db/oracle.types.js'

/** story당 LLM 시나리오 상한(payload 10MiB 방어, blocker#7). stub은 AC 수로 유계. */
export const MAX_SCENARIOS_PER_STORY = 8

const DraftScenarioSchema = z.object({
  title: z.string().default(''),
  given: z.array(z.string()).default([]),
  when: z.string().default(''),
  then: z.array(z.string()).default([]),
  coversCriteria: z.array(z.string()).default([]),
})
const DraftScenariosSchema = z.object({ scenarios: z.array(DraftScenarioSchema).default([]) })
const MAX_TOKENS = 2048

export const DRAFT_SYSTEM_PROMPT = `You draft Given-When-Then acceptance SCENARIOS (oracle drafts) for a user story.

Return ONLY valid JSON:
{ "scenarios": [ { "title": "...", "given": ["..."], "when": "...", "then": ["..."], "coversCriteria": ["<exact acceptance criterion text>"] } ] }

- Behavior-first: observable terms only (no implementation/code words).
- Every acceptance criterion MUST be covered by >=1 scenario via "coversCriteria" (use the EXACT criterion text).
- Include happy-path and key edge/negative scenarios. No prose outside JSON.`

/**
 * P7: story별 GWT 시나리오 초안(status='drafted'). 커버리지 보장(미커버 AC→stub), 상한 절단, oracleId 미부여
 * (consumer가 workflowId로 파생). LLM 실패면 runStage fallback(빈)→AC별 stub. scenarioId='{storyId}-sc{n}'.
 */
export async function draftOracles(stories: Story[], deps: StageDeps): Promise<OracleDraft[]> {
  const drafts: OracleDraft[] = []
  for (const story of stories) {
    const data = await runStage(deps, {
      system: DRAFT_SYSTEM_PROMPT,
      user: `Story: ${story.title}\nAcceptance criteria:\n${story.acceptanceCriteria.map((a) => `- ${a}`).join('\n')}`,
      maxTokens: MAX_TOKENS,
      schema: DraftScenariosSchema,
      fallback: () => ({ scenarios: [] }),
    })
    const scenarios: OracleScenario[] = []
    const coverage: Record<string, string[]> = {}
    const acSet = new Set(story.acceptanceCriteria)
    let n = 0
    for (const sc of (data.scenarios ?? []).slice(0, MAX_SCENARIOS_PER_STORY)) {
      const id = `${story.storyId}-sc${++n}`
      scenarios.push({ id, title: sc.title ?? '', given: sc.given ?? [], when: sc.when ?? '', then: sc.then ?? [], status: 'drafted' })
      for (const ac of sc.coversCriteria ?? []) {
        if (!acSet.has(ac)) continue
        const ids = coverage[ac] ?? []
        ids.push(id)
        coverage[ac] = ids
      }
    }
    for (const ac of story.acceptanceCriteria) {
      if (!coverage[ac]?.length) {
        const id = `${story.storyId}-sc${++n}`
        scenarios.push({ id, title: ac, given: [], when: '', then: [ac], status: 'drafted' })
        coverage[ac] = [id]
      }
    }
    drafts.push({ storyId: story.storyId, scenarios, coverage })
  }
  return drafts
}
