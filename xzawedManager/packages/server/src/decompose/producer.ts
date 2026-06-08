import { z } from 'zod'
import { callClaudeText, makeEnvelope } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { toWorkPackages, type LlmWorkPackage } from './map.js'

/** Supervisor DecompositionConsumer가 구독하는 스트림(manager:decomposition:{channel='main'}). */
export const DECOMPOSE_STREAM = 'manager:decomposition:main'
const LLM_TIMEOUT_MS = Number(process.env['CLAUDE_TIMEOUT_MS'] ?? '120000')
const MAX_TOKENS = 2048

export type DecomposePublish = (stream: string, message: Record<string, unknown>) => Promise<unknown>

export interface ProduceDeps {
  claude: ClaudeLike
  model: string
  publish: DecomposePublish
  now?: () => number
}

const LlmWpSchema = z.object({
  ref: z.string().min(1),
  storyId: z.string().min(1),
  owningRole: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
})
const DecompositionLlmSchema = z.object({ workPackages: z.array(LlmWpSchema) })

export const DECOMPOSE_SYSTEM_PROMPT = `You are a software project decomposition agent. Given a development intent, break it into work packages.

Return ONLY valid JSON in this exact format:
{
  "workPackages": [
    { "ref": "wp-1", "storyId": "story-1", "owningRole": "developer", "acceptanceCriteria": ["..."], "dependsOn": [] }
  ]
}

- "ref" is a LOCAL temporary id used only for cross-references; the system assigns final ids.
- "dependsOn" lists the refs of work packages that must complete first.
- "owningRole" is one of: developer, designer, tester, builder, security.
- Each work package = single role, one execution cycle, verifiable acceptance criteria.
Return only the JSON, no prose.`

/** intent 한 줄을 단일 WP 초안으로(파싱 실패·빈 결과 시). */
function fallback(intent: string): LlmWorkPackage[] {
  return [{ ref: 'wp-1', storyId: 'story-1', owningRole: 'developer', acceptanceCriteria: [intent], dependsOn: [] }]
}

/** LLM 텍스트 → WP 초안[]. 실패·빈 결과는 fallback. */
function parseLlm(text: string, intent: string): LlmWorkPackage[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return fallback(intent)
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return fallback(intent)
  }
  const parsed = DecompositionLlmSchema.safeParse(raw)
  if (!parsed.success || parsed.data.workPackages.length === 0) return fallback(intent)
  return parsed.data.workPackages
}

/**
 * intent → 단일 LLM 분해 → WP[] → decomposition.emitted 발행. 워크플로 1건.
 * Claude 호출·파싱·매핑 실패는 모두 fallback(단일 WP)로 흡수 — 빈 발행 없음.
 */
export async function produceDecomposition(
  intent: string,
  workflowId: string,
  deps: ProduceDeps,
): Promise<{ emitted: number }> {
  let llmWps: LlmWorkPackage[]
  try {
    const text = await callClaudeText(deps.claude, deps.model, MAX_TOKENS, DECOMPOSE_SYSTEM_PROMPT, `Intent: ${intent}`, LLM_TIMEOUT_MS)
    llmWps = parseLlm(text, intent)
  } catch {
    llmWps = fallback(intent)
  }

  let workPackages
  try {
    workPackages = toWorkPackages(llmWps)
    if (workPackages.length === 0) workPackages = toWorkPackages(fallback(intent))
  } catch {
    workPackages = toWorkPackages(fallback(intent))
  }

  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: 'decomposition.emitted', attemptId: 0 },
    deps.now?.(),
  )
  await deps.publish(DECOMPOSE_STREAM, { envelope, type: 'decomposition.emitted', payload: { workPackages } })
  return { emitted: workPackages.length }
}
