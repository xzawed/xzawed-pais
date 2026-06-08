import { z } from 'zod'
import { runStage, type StageDeps } from './run-stage.js'

const DeliverablesSchema = z.object({ deliverables: z.array(z.string()).default([]) })

const MAX_TOKENS = 1024

export const DELIVERABLES_SYSTEM_PROMPT = `You are a product manager building a WBS DELIVERABLE inventory for a development goal.

Return ONLY valid JSON:
{ "deliverables": ["deliverable id or short name", "..."] }

- List the concrete artifacts the goal requires (independent of any story breakdown).
- Include compliance/security/ops artifacts where relevant.
- Each entry is a short stable id/name. No prose.`

/**
 * P3: intent → deliverable 인벤토리. slice와 분리된 독립 호출(§20.2 교차각도) — 매트릭스가 두 시각을 대조.
 * 실패면 빈 인벤토리. 중복·빈 문자열 제거(입력 순서 보존 = 결정론).
 */
export async function deriveDeliverables(intent: string, deps: StageDeps): Promise<string[]> {
  const data = await runStage(deps, {
    system: DELIVERABLES_SYSTEM_PROMPT,
    user: `Intent: ${intent}`,
    maxTokens: MAX_TOKENS,
    schema: DeliverablesSchema,
    fallback: () => ({ deliverables: [] as string[] }),
  })
  return [...new Set((data.deliverables ?? []).filter((d) => d.length > 0))]
}
