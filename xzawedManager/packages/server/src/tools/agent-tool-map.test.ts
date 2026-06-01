import { describe, it, expect } from 'vitest'
import { AGENT_TO_TOOL, resolveAgentTool } from './agent-tool-map.js'

describe('agent-tool-map', () => {
  it('7개 에이전트가 도구명으로 매핑된다', () => {
    expect(AGENT_TO_TOOL.planner).toBe('plan_task')
    expect(AGENT_TO_TOOL.developer).toBe('develop_code')
    expect(AGENT_TO_TOOL.designer).toBe('design_ui')
    expect(AGENT_TO_TOOL.tester).toBe('run_tests')
    expect(AGENT_TO_TOOL.builder).toBe('build_project')
    expect(AGENT_TO_TOOL.watcher).toBe('watch_changes')
    expect(AGENT_TO_TOOL.security).toBe('security_audit')
  })

  it('resolveAgentTool은 알 수 없는 에이전트에 undefined', () => {
    expect(resolveAgentTool('developer')).toBe('develop_code')
    expect(resolveAgentTool('nope')).toBeUndefined()
  })
})
