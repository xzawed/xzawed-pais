import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'

/** P1 결과 단위. epicRef는 후속 단계(slice)에서 story↔epic 연결에 쓰는 임시 ref. */
export interface Epic {
  epicRef: string
  title: string
}

const EpicsSchema = z.object({
  epics: z.array(z.object({ epicRef: z.string().min(1), title: z.string().min(1) })).default([]),
})

const MAX_TOKENS = 1024

export const EPICS_SYSTEM_PROMPT = `You are a product manager decomposing a development goal into EPICS (coarse value themes).

Return ONLY valid JSON:
{ "epics": [ { "epicRef": "epic-1", "title": "short epic theme" } ] }

- An epic is a coarse, user-valuable theme — not a task or a role.
- "epicRef" is a local temporary id used only to link later stages.
- Keep epics few and high-level (typically 1-5). No prose.`

/** P1: intent → epic[]. 실패·빈 결과면 intent를 단일 epic으로 degrade. */
export async function identifyEpics(intent: string, deps: StageDeps): Promise<Epic[]> {
  const fallback = (): { epics: Epic[] } => ({ epics: [{ epicRef: 'epic-1', title: intent }] })
  const data = await runStage(deps, {
    system: EPICS_SYSTEM_PROMPT,
    user: `Intent: ${intent}`,
    maxTokens: MAX_TOKENS,
    schema: EpicsSchema,
    fallback,
  })
  const epics = data.epics ?? []
  return epics.length > 0 ? epics : fallback().epics
}
