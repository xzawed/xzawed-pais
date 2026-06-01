import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GATE_CONFIG, effectiveMode, isGatedTool,
  summarizeOutput, parseDecision, GATED_TOOLS,
} from './approval-gate.js'

describe('isGatedTool', () => {
  it('에이전트 디스패치 도구는 게이트 대상', () => {
    expect(isGatedTool('plan_task')).toBe(true)
    expect(isGatedTool('security_audit')).toBe(true)
  })
  it('배포 도구도 게이트 대상', () => {
    expect(isGatedTool('deploy_project')).toBe(true)
  })
  it('보조 도구는 비대상', () => {
    expect(isGatedTool('register_project')).toBe(false)
    expect(isGatedTool('github_ops')).toBe(false)
    expect(isGatedTool('request_info')).toBe(false)
  })
  it('GATED_TOOLS는 7개(배포 제외)', () => {
    expect(GATED_TOOLS.size).toBe(7)
  })
})

describe('배포 게이트(항상 manual)', () => {
  it('defaultMode가 auto여도 배포는 manual', () => {
    const cfg = { defaultMode: 'auto' as const, overrides: {} }
    expect(effectiveMode(cfg, 'deploy_project')).toBe('manual')
  })
  it('override로 auto를 줘도 배포는 manual', () => {
    const cfg = { defaultMode: 'manual' as const, overrides: { deploy_project: 'auto' as const } }
    expect(effectiveMode(cfg, 'deploy_project')).toBe('manual')
  })
})

describe('effectiveMode', () => {
  it('기본은 manual', () => {
    expect(effectiveMode(DEFAULT_GATE_CONFIG, 'plan_task')).toBe('manual')
  })
  it('override가 defaultMode를 이긴다', () => {
    const cfg = { defaultMode: 'manual' as const, overrides: { plan_task: 'auto' as const } }
    expect(effectiveMode(cfg, 'plan_task')).toBe('auto')
    expect(effectiveMode(cfg, 'design_ui')).toBe('manual')
  })
  it('defaultMode auto면 override 없는 단계는 auto', () => {
    const cfg = { defaultMode: 'auto' as const, overrides: { design_ui: 'manual' as const } }
    expect(effectiveMode(cfg, 'plan_task')).toBe('auto')
    expect(effectiveMode(cfg, 'design_ui')).toBe('manual')
  })
})

describe('parseDecision', () => {
  it('approve JSON', () => {
    expect(parseDecision('{"decision":"approve"}')).toEqual({ kind: 'approve', rememberAuto: false })
  })
  it('approve + rememberAuto', () => {
    expect(parseDecision('{"decision":"approve","rememberAuto":true}'))
      .toEqual({ kind: 'approve', rememberAuto: true })
  })
  it('revise + feedback', () => {
    expect(parseDecision('{"decision":"revise","feedback":"색상 변경"}'))
      .toEqual({ kind: 'revise', feedback: '색상 변경' })
  })
  it('abort', () => {
    expect(parseDecision('{"decision":"abort"}')).toEqual({ kind: 'abort' })
  })
  it('파싱 불가 문자열은 approve로 fail-open', () => {
    expect(parseDecision('그냥 진행')).toEqual({ kind: 'approve', rememberAuto: false })
  })
  it('알 수 없는 decision은 approve', () => {
    expect(parseDecision('{"decision":"xxx"}')).toEqual({ kind: 'approve', rememberAuto: false })
  })
  it('revise인데 feedback 없으면 빈 문자열', () => {
    expect(parseDecision('{"decision":"revise"}')).toEqual({ kind: 'revise', feedback: '' })
  })
})

describe('summarizeOutput', () => {
  it('객체를 JSON 문자열로 요약하되 상한 길이로 자른다', () => {
    const s = summarizeOutput('plan_task', { content: 'x'.repeat(5000) })
    expect(s.length).toBeLessThanOrEqual(2000 + '...[truncated]'.length)
    expect(s.endsWith('...[truncated]')).toBe(true)
  })
  it('content 필드가 있으면 우선 사용', () => {
    const s = summarizeOutput('design_ui', { content: '로그인 폼', uiSpec: { type: 'form' } })
    expect(s).toContain('로그인 폼')
  })
  it('content 없으면 전체 직렬화', () => {
    const s = summarizeOutput('run_tests', { passed: 10, failed: 0 })
    expect(s).toContain('passed')
  })
})
