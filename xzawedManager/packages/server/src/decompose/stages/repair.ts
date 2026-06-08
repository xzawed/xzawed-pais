import type { CoverageMatrix } from '@xzawed/agent-streams'
import { runStage, type StageDeps } from './run-stage.js'
import { StoriesSchema, type Story } from './slice.js'

const MAX_TOKENS = 2048

export const REPAIR_SYSTEM_PROMPT = `You are a product manager REPAIRING a story decomposition to satisfy the 100% coverage rule.

You are given the current stories, the deliverable inventory, and a coverage report:
- "gaps": deliverables that NO story currently claims (each must be claimed by exactly one story).
- "overlaps": deliverables claimed by MULTIPLE stories (assign each to exactly one).
- "unknownClaims": story claims not present in the inventory (remove or correct).

Return ONLY valid JSON — the FULL revised story set, same shape as the input:
{ "stories": [ { "storyId": "s1", "epicRef": "epic-1", "title": "...", "deliverableIds": ["..."], "acceptanceCriteria": ["..."] } ] }

- Adjust deliverableIds so every gap is claimed by exactly one story and no deliverable is claimed by more than one.
- You may add a story to cover gaps, but keep storyIds stable for unchanged stories.
- No prose.`

/**
 * P4 수선 단계: 현재 stories + coverage(gaps/overlaps/unknownClaims)를 받아 claim을 재조정한 전체 stories 반환.
 * 실패·빈 결과면 입력 stories 그대로(개선 없음 → 루프 소진 → 에스컬레이션). LLM은 의미 수선만.
 */
export async function repairStories(
  stories: Story[],
  deliverables: string[],
  coverage: CoverageMatrix,
  deps: StageDeps,
): Promise<Story[]> {
  const fallback = (): { stories: Story[] } => ({ stories })
  const user = [
    `Stories:\n${JSON.stringify(stories)}`,
    `Deliverable inventory:\n${JSON.stringify(deliverables)}`,
    `Coverage gaps (uncovered deliverables): ${JSON.stringify(coverage.gaps)}`,
    `Coverage overlaps (multi-claimed): ${JSON.stringify(coverage.overlaps)}`,
    `Unknown claims (not in inventory): ${JSON.stringify(coverage.unknownClaims)}`,
  ].join('\n\n')
  const data = await runStage(deps, {
    system: REPAIR_SYSTEM_PROMPT,
    user,
    maxTokens: MAX_TOKENS,
    schema: StoriesSchema,
    fallback,
  })
  const revised = data.stories ?? []
  return revised.length > 0 ? revised : stories
}
