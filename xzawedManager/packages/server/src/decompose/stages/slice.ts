import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'
import type { Epic } from './epics.js'

/** P2 결과 단위. deliverableIds = 이 story가 덮는다고 주장하는 산출물 id(커버리지 매트릭스 입력). */
export interface Story {
  storyId: string
  epicRef: string
  title: string
  deliverableIds: string[]
  acceptanceCriteria: string[]
}

export const StoryItemSchema = z.object({
  storyId: z.string().min(1),
  epicRef: z.string(),
  title: z.string(),
  deliverableIds: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
})

export const StoriesSchema = z.object({
  stories: z.array(StoryItemSchema).default([]),
})

const MAX_TOKENS = 2048

export const SLICE_SYSTEM_PROMPT = `You are a product manager slicing epics into INVEST vertical-slice STORIES.

Return ONLY valid JSON:
{ "stories": [ { "storyId": "s1", "epicRef": "epic-1", "title": "...", "deliverableIds": ["..."], "acceptanceCriteria": ["..."] } ] }

- Slice VERTICALLY (end-to-end user value), not by role/function.
- "epicRef" links the story to its epic (use the provided epic refs).
- "deliverableIds" = the concrete artifacts this story claims to cover (your independent view).
- "acceptanceCriteria" = verifiable conditions for the story. No prose.`

/** P2: epics → stories. 실패·빈 결과면 각 epic을 단일 story로 degrade. */
export async function sliceVertical(epics: Epic[], intent: string, deps: StageDeps): Promise<Story[]> {
  const fallback = (): { stories: Story[] } => ({
    stories: epics.map((e, i) => ({
      storyId: `story-${i + 1}`,
      epicRef: e.epicRef,
      title: e.title,
      deliverableIds: [],
      acceptanceCriteria: [e.title],
    })),
  })
  const user = `Intent: ${intent}\nEpics:\n${epics.map((e) => `- ${e.epicRef}: ${e.title}`).join('\n')}`
  const data = await runStage(deps, {
    system: SLICE_SYSTEM_PROMPT,
    user,
    maxTokens: MAX_TOKENS,
    schema: StoriesSchema,
    fallback,
  })
  const stories = data.stories ?? []
  return stories.length > 0 ? stories : fallback().stories
}
