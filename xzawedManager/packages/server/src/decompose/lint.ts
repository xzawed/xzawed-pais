/**
 * §6 P5 소프트 린트: 정확히 한 직능으로만 매핑된 story id(수평 분해 의심·재슬라이싱 후보).
 * 순수 함수·결정론(사전순). 흐름에 영향 없는 advisory 신호(로그 전용).
 */
export function singleRoleStoryIds(roles: Map<string, string[]>): string[] {
  const ids: string[] = []
  for (const [storyId, r] of roles) {
    if (r.length === 1) ids.push(storyId)
  }
  return ids.sort()
}
