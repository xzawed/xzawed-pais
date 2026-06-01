import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () { return { messages: { create: mockCreate } } }),
}))

import { ClaudeRunner } from './runner.js'

let runner: ClaudeRunner

beforeEach(() => {
  vi.clearAllMocks()
  runner = new ClaudeRunner('sk-test', 'claude-test')
})

describe('ClaudeRunner.parseFailures', () => {
  it('parses valid JSON array of failures', () => {
    const input = JSON.stringify([
      { file: 'src/a.test.ts', testName: 'should work', message: 'expected 1 to be 2', suggestion: 'fix the assertion' },
    ])
    const result = runner.parseFailures(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.testName).toBe('should work')
  })

  it('strips code fences', () => {
    const input = '```json\n[{"file":"f.ts","testName":"t","message":"m","suggestion":"s"}]\n```'
    expect(runner.parseFailures(input)).toHaveLength(1)
  })

  it('filters items missing required fields', () => {
    const input = JSON.stringify([
      { file: 'f.ts', testName: 't', message: 'm', suggestion: 's' },
      { file: 'f.ts', testName: 't' },
    ])
    expect(runner.parseFailures(input)).toHaveLength(1)
  })

  it('returns [] for invalid JSON', () => {
    expect(runner.parseFailures('not json')).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(runner.parseFailures('')).toEqual([])
  })
})

describe('ClaudeRunner.analyzeFailures', () => {
  it('returns parsed failures from Claude', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify([{ file: 'test.ts', testName: 'auth test', message: 'fail', suggestion: 'fix' }]),
      }],
    })
    const result = await runner.analyzeFailures('test output with failures')
    expect(result).toHaveLength(1)
    expect(result[0]?.testName).toBe('auth test')
  })

  it('returns [] when SDK throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('timeout'))
    const result = await runner.analyzeFailures('output')
    expect(result).toEqual([])
  })
})

describe('ClaudeRunner.answerQuery', () => {
  it('Claude 텍스트 답변을 반환한다', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '테스트 관점 답변' }] })
    expect(await runner.answerQuery('재고 표시 가능?', { x: 1 })).toBe('테스트 관점 답변')
  })
})
