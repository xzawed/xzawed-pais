import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'
import type { Story } from './slice.js'
import type { OracleInvariant } from '../../db/oracle.types.js'

/** story당 LLM invariant 상한(payload 방어·유계). */
export const MAX_INVARIANTS_PER_STORY = 6

const DraftInvariantSchema = z.object({
  statement: z.string().default(''),
  domain: z.string().default(''),
  property: z.string().default(''),
})
const DraftInvariantsSchema = z.object({ invariants: z.array(DraftInvariantSchema).default([]) })
const MAX_TOKENS = 2048

export const INVARIANT_SYSTEM_PROMPT = `You draft DOMAIN INVARIANTS (always-true properties) for a user story.

Return ONLY valid JSON:
{ "invariants": [ { "statement": "...", "domain": "...", "property": "..." } ] }

- An invariant is a property that MUST hold for EVERY valid state/operation (not a single scenario).
- "statement": human-readable rule (e.g. "account balance never goes negative").
- "domain": the area it constrains (e.g. "account balance").
- "property": a boundary-testable condition (e.g. "for all withdrawals, resulting balance >= 0").
- Only include GENUINE invariants derivable from the story. If the story has none, return an empty array.
- No prose outside JSON.`

/**
 * F5: story별 도메인 invariant 초안(status='drafted'). 커버리지 의무 없음(stub 강제 안 함) — LLM이 진짜
 * 불변식을 못 찾으면 빈. invariantId='{storyId}-inv{n}'(결정론). LLM 실패면 runStage fallback(빈)·never-throw.
 */
export async function draftInvariants(stories: Story[], deps: StageDeps): Promise<Map<string, OracleInvariant[]>> {
  const byStory = new Map<string, OracleInvariant[]>()
  for (const story of stories) {
    const acList = story.acceptanceCriteria.map((a) => `- ${a}`).join('\n')
    const data = await runStage(deps, {
      system: INVARIANT_SYSTEM_PROMPT,
      user: `Story: ${story.title}\nAcceptance criteria:\n${acList}`,
      maxTokens: MAX_TOKENS,
      schema: DraftInvariantsSchema,
      fallback: () => ({ invariants: [] }),
    })
    const invariants: OracleInvariant[] = []
    let n = 0
    // 빈 statement(저품질) 드롭을 cap보다 먼저 — 유효 불변식이 cap 너머에 있어도 손실 없이 최대 N개를 채운다.
    const valid = (data.invariants ?? [])
      .map((inv) => ({ ...inv, statement: (inv.statement ?? '').trim() }))
      .filter((inv) => inv.statement)
    for (const inv of valid.slice(0, MAX_INVARIANTS_PER_STORY)) {
      invariants.push({ id: `${story.storyId}-inv${++n}`, statement: inv.statement, domain: inv.domain ?? '', property: inv.property ?? '', status: 'drafted' })
    }
    byStory.set(story.storyId, invariants)
  }
  return byStory
}
