import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { ClaudeRunner } from './runner.js'

function mockResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  })
}

let runner: ClaudeRunner

beforeEach(() => {
  vi.clearAllMocks()
  runner = new ClaudeRunner('sk-test', 'claude-test')
})

describe('ClaudeRunner.parseChanges', () => {
  it('parses valid JSON array', () => {
    const input = JSON.stringify([
      { path: '/app/src/a.ts', operation: 'create', content: 'hello' },
      { path: '/app/src/b.ts', operation: 'delete' },
    ])
    const result = runner.parseChanges(input)
    expect(result).toHaveLength(2)
    expect(result[0]?.operation).toBe('create')
    expect(result[1]?.operation).toBe('delete')
  })

  it('strips ```json code fences', () => {
    const input = '```json\n[{"path":"/a.ts","operation":"create","content":"x"}]\n```'
    const result = runner.parseChanges(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('/a.ts')
  })

  it('strips plain ``` code fences', () => {
    const input = '```\n[{"path":"/b.ts","operation":"modify","content":"y"}]\n```'
    const result = runner.parseChanges(input)
    expect(result).toHaveLength(1)
  })

  it('returns [] for empty string', () => {
    expect(runner.parseChanges('')).toEqual([])
  })

  it('returns [] for invalid JSON', () => {
    expect(runner.parseChanges('not json at all')).toEqual([])
  })

  it('returns [] when JSON is not an array', () => {
    expect(runner.parseChanges('{"path":"/a.ts"}')).toEqual([])
  })

  it('filters items missing required fields', () => {
    const input = JSON.stringify([
      { path: '/a.ts', operation: 'create', content: 'x' },
      { path: '/b.ts' },
      { operation: 'delete' },
    ])
    const result = runner.parseChanges(input)
    expect(result).toHaveLength(1)
  })

  it('create/modify without content is filtered out', () => {
    const input = JSON.stringify([
      { path: '/a.ts', operation: 'create' },
      { path: '/b.ts', operation: 'modify' },
      { path: '/c.ts', operation: 'delete' },
    ])
    const result = runner.parseChanges(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.operation).toBe('delete')
  })
})

describe('ClaudeRunner.generateChanges', () => {
  it('returns changes and summary', async () => {
    mockResponse(JSON.stringify([
      { path: '/app/src/auth.ts', operation: 'create', content: 'export {}' },
    ]))
    const { changes, summary } = await runner.generateChanges('add auth', '/app', {})
    expect(changes).toHaveLength(1)
    expect(summary).toContain('1 file change')
    expect(summary).toContain('add auth')
  })

  it('summary is capped at 100 chars of plan', async () => {
    const longPlan = 'x'.repeat(200)
    mockResponse('[]')
    const { summary } = await runner.generateChanges(longPlan, '/app', {})
    expect(summary).toContain('x'.repeat(100))
    expect(summary.length).toBeLessThan(longPlan.length + 50)
  })
})
