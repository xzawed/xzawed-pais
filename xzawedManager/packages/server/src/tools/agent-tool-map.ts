/** 에이전트명 → Manager가 등록한 도구명. AgentQuery.to 라우팅에 사용. */
export const AGENT_TO_TOOL: Record<string, string> = {
  planner: 'plan_task',
  developer: 'develop_code',
  designer: 'design_ui',
  tester: 'run_tests',
  builder: 'build_project',
  watcher: 'watch_changes',
  security: 'security_audit',
}

export function resolveAgentTool(agentName: string): string | undefined {
  return AGENT_TO_TOOL[agentName]
}
