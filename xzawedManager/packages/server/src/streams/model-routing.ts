import type { RoutedAgent, ModelTier } from '@xzawed/agent-streams'

export interface ModelTierIds {
  opus: string
  sonnet: string
}

/** owningRole(소문자) → RoutedAgent(§3). builder는 라우팅 대상 아님 → 미매핑(폴백). */
const ROLE_TO_AGENT: Record<string, RoutedAgent> = {
  developer: 'Developer',
  designer: 'Designer',
  tester: 'Tester',
  security: 'Security',
  planner: 'PM',
  pm: 'PM',
}

/**
 * D5: 승인 modelRouting + owningRole → concrete model id. 매핑/라우팅/tier 부재면 undefined(에이전트 CLAUDE_MODEL 폴백).
 * tier→concrete id는 호출자(워커)가 config로 주입(단일 출처). 순수·부수효과 0.
 */
export function resolveWpModel(
  modelRouting: Record<RoutedAgent, ModelTier> | undefined,
  owningRole: string,
  ids: ModelTierIds,
): string | undefined {
  if (!modelRouting) return undefined
  const agent = ROLE_TO_AGENT[owningRole.toLowerCase()]
  if (!agent) return undefined
  const tier = modelRouting[agent]
  if (tier !== 'opus' && tier !== 'sonnet') return undefined
  return tier === 'opus' ? ids.opus : ids.sonnet
}
