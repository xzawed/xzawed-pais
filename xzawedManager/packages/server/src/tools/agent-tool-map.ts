/**
 * 답변(교차질의) 가능한 에이전트명 → Manager가 등록한 도구명. AgentQuery.to 라우팅에만 사용.
 *
 * ⚠️ watcher는 의도적으로 제외한다 — Claude 미사용·`createCollaborativeHandler` 미적용으로 질의에
 * 답변할 수 없다. 라우팅 대상이 되면 watch_changes 스키마 검증 실패(triggers 필수)로 DLQ→120초
 * 타임아웃이 되고, triggers를 채우면 실제 파일 감시를 시작하는 부작용이 생긴다. 맵에서 빼두면
 * `resolveAgentTool('watcher')`가 undefined를 반환해 runner가 즉시 is_error로 거부한다.
 * (planner 프롬프트의 "to" 후보가 AGENT_TYPES와 한 소스를 공유해 watcher도 노출되므로, LLM이
 *  watcher로 질의를 보내도 안전하도록 Manager 단에서 방어한다.)
 */
export const AGENT_TO_TOOL: Record<string, string> = {
  planner: 'plan_task',
  developer: 'develop_code',
  designer: 'design_ui',
  tester: 'run_tests',
  builder: 'build_project',
  security: 'security_audit',
}

export function resolveAgentTool(agentName: string): string | undefined {
  return AGENT_TO_TOOL[agentName]
}
