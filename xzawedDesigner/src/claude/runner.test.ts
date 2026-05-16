import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { ClaudeRunner } from './runner.js'

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
    const result = runner.parseResponse(json, 'login form')
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.name).toBe('LoginForm')
    expect(result.uiSpec.type).toBe('mockup_viewer')
  })

  it('strips ```json code fences', () => {
    const json = '```json\n{"components":[{"name":"Btn","description":"x","props":{}}],"uiSpec":{"type":"mockup_viewer"}}\n```'
    const result = runner.parseResponse(json, 'button')
    expect(result.components[0]?.name).toBe('Btn')
  })

  it('strips plain ``` code fences', () => {
    const json = '```\n{"components":[{"name":"X","description":"y","props":{}}],"uiSpec":{"type":"mockup_viewer"}}\n```'
    const result = runner.parseResponse(json, 'x')
    expect(result.components).toHaveLength(1)
  })

  it('returns fallback for empty string', () => {
    const result = runner.parseResponse('', 'fallback intent')
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.name).toBe('Component')
  })

  it('returns fallback for empty components array', () => {
    const result = runner.parseResponse('{"components":[],"uiSpec":{"type":"mockup_viewer"}}', 'x')
    expect(result.components[0]?.name).toBe('Component')
  })

  it('uses fallback uiSpec when absent in response', () => {
    const result = runner.parseResponse(
      '{"components":[{"name":"A","description":"b","props":{}}]}',
      'my intent'
    )
    expect(result.uiSpec.title).toContain('my intent')
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
    const result = await runner.generateDesign('card component', {}, 'react', 'tailwind')
    expect(result.components[0]?.name).toBe('Card')
    expect(result.uiSpec.title).toBe('Card UI')
  })

  it('returns fallback when SDK throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'))
    const result = await runner.generateDesign('something', {}, 'react', 'tailwind')
    expect(result.components).toHaveLength(1)
    expect(result.components[0]?.name).toBe('Component')
  })
})
