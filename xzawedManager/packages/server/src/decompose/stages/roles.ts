import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'
import type { Story } from './slice.js'

const RolesSchema = z.object({
  assignments: z
    .array(z.object({ storyId: z.string().min(1), roles: z.array(z.string()).default([]) }))
    .default([]),
})

const MAX_TOKENS = 1024
const DEFAULT_ROLE = 'developer'

export const ROLES_SYSTEM_PROMPT = `You assign the REQUIRED ROLES for each story (horizontal split within a vertical slice).

Return ONLY valid JSON:
{ "assignments": [ { "storyId": "s1", "roles": ["developer"] } ] }

- "roles" is a subset of: developer, designer, tester, builder, security.
- Assign only the roles a story genuinely needs. No prose.`

/**
 * P5: stories → storyId별 역할 Map. 미지/누락 storyId·빈 역할은 기본 역할로 보정(모든 story ≥1 역할 보장).
 * 실패면 전 story 기본 역할.
 */
export async function assignRoles(stories: Story[], deps: StageDeps): Promise<Map<string, string[]>> {
  const fallback = () => ({ assignments: stories.map((s) => ({ storyId: s.storyId, roles: [DEFAULT_ROLE] })) })
  const user = `Stories:\n${stories.map((s) => `- ${s.storyId}: ${s.title}`).join('\n')}`
  const data = await runStage(deps, {
    system: ROLES_SYSTEM_PROMPT,
    user,
    maxTokens: MAX_TOKENS,
    schema: RolesSchema,
    fallback,
  })
  const byStory = new Map<string, string[]>()
  for (const a of data.assignments ?? []) {
    const roles = [...new Set((a.roles ?? []).filter((r) => r.length > 0))]
    if (roles.length > 0) byStory.set(a.storyId, roles)
  }
  for (const s of stories) {
    if (!byStory.has(s.storyId)) byStory.set(s.storyId, [DEFAULT_ROLE])
  }
  return byStory
}
