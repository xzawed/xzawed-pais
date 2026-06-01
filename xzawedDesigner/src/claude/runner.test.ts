import { vi, describe, it, expect, beforeEach } from 'vitest'
import { AgentQuery } from '@xzawed/agent-streams'
import type { ComponentSpec, UISpec } from '../types.js'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { ClaudeRunner } from './runner.js'

/** generateDesign/parseResponse 결과를 디자인 형태로 좁힌다(AgentQuery면 실패). */
function asDesign(
  r: { components: ComponentSpec[]; uiSpec: UISpec } | AgentQuery,
): { components: ComponentSpec[]; uiSpec: UISpec } {
  if (r instanceof AgentQuery) throw new Error('expected design result, got AgentQuery')
  return r
}

let runner: ClaudeRunner

beforeEach(() => {
  vi.clearAllMocks()
  runner = new ClaudeRunner('sk-test', 'claude-test')
})

describe('ClaudeRunner.parseResponse', () => {
  it('parses valid JSON with components and uiSpec', () => {
    const json = JSON.stringify({
      components: [{ name: 'LoginForm', description: 'login', props: { onSubmit: '() => void' } }],
      uiSpec: { type: 'mockup_viewer', title: 'Login', content: 'login page' },
    })
    const result = asDesign(runner.parseResponse(json, 'login form'))
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.name).toBe('LoginForm')
    expect(result.uiSpec.type).toBe('mockup_viewer')
  })

  it('strips ```json code fences', () => {
    const json = '```json\n{"components":[{"name":"Btn","description":"x","props":{}}],"uiSpec":{"type":"mockup_viewer"}}\n```'
    const result = asDesign(runner.parseResponse(json, 'button'))
    expect(result.components[0]?.name).toBe('Btn')
  })

  it('strips plain ``` code fences', () => {
    const json = '```\n{"components":[{"name":"X","description":"y","props":{}}],"uiSpec":{"type":"mockup_viewer"}}\n```'
    const result = asDesign(runner.parseResponse(json, 'x'))
    expect(result.components).toHaveLength(1)
  })

  it('returns fallback for empty string', () => {
    const result = asDesign(runner.parseResponse('', 'fallback intent'))
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.name).toBe('Component')
  })

  it('returns fallback for empty components array', () => {
    const result = asDesign(runner.parseResponse('{"components":[],"uiSpec":{"type":"mockup_viewer"}}', 'x'))
    expect(result.components[0]?.name).toBe('Component')
  })

  it('JSON.parse 실패 시 fallback을 반환한다', () => {
    // Has { and } but invalid JSON — triggers catch block (lines 125-126)
    const result = asDesign(runner.parseResponse('{invalid json here}', 'test intent'))
    expect(result.components[0]?.name).toBe('Component')
    expect(result.uiSpec.type).toBe('mockup_viewer')
  })

  it('uses fallback uiSpec when absent in response', () => {
    const result = asDesign(runner.parseResponse(
      '{"components":[{"name":"A","description":"b","props":{}}]}',
      'my intent'
    ))
    expect(result.uiSpec.title).toContain('my intent')
  })

  it('agent_query 응답을 AgentQuery로 파싱한다', () => {
    const json = JSON.stringify({ agent_query: true, to: 'developer', question: '재고 표시 가능?', kind: 'active_request' })
    const result = runner.parseResponse(json, 'cart')
    expect(result).toBeInstanceOf(AgentQuery)
    expect((result as AgentQuery).to).toBe('developer')
  })
})

describe('ClaudeRunner.generateDesign', () => {
  it('returns components and uiSpec on success', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          components: [{ name: 'Card', description: 'card', props: {} }],
          uiSpec: { type: 'mockup_viewer', title: 'Card UI' },
        }),
      }],
    })
    const result = asDesign(await runner.generateDesign('card component', {}, 'react', 'tailwind'))
    expect(result.components[0]?.name).toBe('Card')
    expect(result.uiSpec.title).toBe('Card UI')
  })

  it('API 오류 시 에러를 던진다', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'))
    await expect(runner.generateDesign('버튼 컴포넌트', {}, 'react', 'tailwind')).rejects.toThrow('Network error')
  })

  it('유효한 응답을 반환한다', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          components: [{ name: 'Button', description: 'A button', props: { onClick: '() => void' } }],
          uiSpec: { type: 'mockup_viewer', title: 'Button', content: 'button' },
        }),
      }],
    })
    const result = asDesign(await runner.generateDesign('버튼 컴포넌트', {}, 'react', 'tailwind'))
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.name).toBe('Button')
  })
})
