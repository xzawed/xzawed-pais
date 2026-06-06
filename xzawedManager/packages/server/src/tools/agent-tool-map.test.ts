import { describe, it, expect } from 'vitest'
import { AGENT_TO_TOOL, resolveAgentTool } from './agent-tool-map.js'

describe('agent-tool-map', () => {
  it('6개 답변 가능 에이전트가 도구명으로 매핑된다', () => {
    expect(AGENT_TO_TOOL.planner).toBe('plan_task')
    expect(AGENT_TO_TOOL.developer).toBe('develop_code')
    expect(AGENT_TO_TOOL.designer).toBe('design_ui')
    expect(AGENT_TO_TOOL.tester).toBe('run_tests')
    expect(AGENT_TO_TOOL.builder).toBe('build_project')
    expect(AGENT_TO_TOOL.security).toBe('security_audit')
  })

  it('watcher는 답변 불가(Claude 미사용)라 교차질의 대상에서 제외된다', () => {
    // watcher는 createCollaborativeHandler 미적용 답변 불가 에이전트. 질의 라우팅 대상이 되면
    // watch_changes 스키마 검증 실패(triggers 필수)로 DLQ/타임아웃이 되므로 맵에서 제외해
    // resolveAgentTool이 undefined를 반환 → runner가 즉시 is_error로 거부하게 한다.
    expect(AGENT_TO_TOOL.watcher).toBeUndefined()
    expect(resolveAgentTool('watcher')).toBeUndefined()
  })

  it('resolveAgentTool은 알 수 없는 에이전트에 undefined', () => {
    expect(resolveAgentTool('developer')).toBe('develop_code')
    expect(resolveAgentTool('nope')).toBeUndefined()
  })
})
