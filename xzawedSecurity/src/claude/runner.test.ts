import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn() },
}))

vi.mock('../executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}))

import fs from 'node:fs/promises'
import { validatePath } from '../executor.js'
import { ClaudeRunner } from './runner.js'

const mockReadFile = vi.mocked(fs.readFile)
const mockValidatePath = vi.mocked(validatePath)

let runner: ClaudeRunner

beforeEach(() => {
  vi.clearAllMocks()
  mockValidatePath.mockImplementation((p: string) => Promise.resolve(p))
  mockReadFile.mockResolvedValue('const x = 1' as never)
  runner = new ClaudeRunner('sk-test', 'claude-test')
})

describe('ClaudeRunner.parseIssues', () => {
  it('parses valid JSON array of issues', () => {
    const input = JSON.stringify([
      {
        id: 'CL-001',
        severity: 'high',
        category: 'injection',
        file: 'app.ts',
        description: 'SQL injection',
        suggestion: 'Use parameterized queries',
        cwe: 'CWE-89',
      },
    ])
    const result = runner.parseIssues(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('CL-001')
    expect(result[0]?.severity).toBe('high')
  })

  it('strips code fences', () => {
    const issue = {
      id: 'CL-001',
      severity: 'medium',
      category: 'xss',
      file: 'f.ts',
      description: 'XSS',
      suggestion: 'sanitize',
    }
    const input = `\`\`\`json\n${JSON.stringify([issue])}\n\`\`\``
    expect(runner.parseIssues(input)).toHaveLength(1)
  })

  it('filters items missing required fields', () => {
    const valid = {
      id: 'CL-001',
      severity: 'low',
      category: 'config',
      file: 'f.ts',
      description: 'd',
      suggestion: 's',
    }
    const invalid = { id: 'CL-002', severity: 'high' }
    expect(runner.parseIssues(JSON.stringify([valid, invalid]))).toHaveLength(1)
  })

  it('filters items with invalid severity', () => {
    const issue = {
      id: 'CL-001',
      severity: 'extreme',
      category: 'injection',
      file: 'f.ts',
      description: 'd',
      suggestion: 's',
    }
    expect(runner.parseIssues(JSON.stringify([issue]))).toHaveLength(0)
  })

  it('returns [] for invalid JSON', () => {
    expect(runner.parseIssues('not json')).toEqual([])
  })

  it('returns [] when JSON.parse throws (has braces but invalid syntax)', () => {
    // '[{invalid}]' has { and } so the early return is skipped, then JSON.parse throws (lines 91-92)
    expect(runner.parseIssues('[{invalid}]')).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(runner.parseIssues('')).toEqual([])
  })

  it('returns [] for empty array', () => {
    expect(runner.parseIssues('[]')).toEqual([])
  })
})

describe('ClaudeRunner.answerQuery', () => {
  it('Claude 텍스트 답변을 반환한다', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '보안 관점 답변' }] })
    expect(await runner.answerQuery('이 암호화 안전한가?', {})).toBe('보안 관점 답변')
  })
})

describe('ClaudeRunner.analyzeArtifacts', () => {
  it('returns empty issues for empty file list', async () => {
    const result = await runner.analyzeArtifacts([], '/workspace')
    expect(result.issues).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns parsed issues from Claude (object form)', async () => {
    const issue = {
      id: 'CL-001',
      severity: 'high',
      category: 'injection',
      file: 'app.ts',
      description: 'SQL injection',
      suggestion: 'Use parameterized queries',
    }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ issues: [issue], knowledge: ['외부 입력은 항상 검증'] }) }],
    })
    const result = await runner.analyzeArtifacts(['/workspace/app.ts'], '/workspace')
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.id).toBe('CL-001')
    expect(result.knowledge).toEqual(['외부 입력은 항상 검증'])
  })

  it('parses legacy array form (하위호환)', async () => {
    const issue = {
      id: 'CL-002', severity: 'low', category: 'config', file: 'a.ts',
      description: 'x', suggestion: 'y',
    }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify([issue]) }],
    })
    const result = await runner.analyzeArtifacts(['/workspace/app.ts'], '/workspace')
    expect(result.issues).toHaveLength(1)
    expect(result.knowledge).toBeUndefined()
  })

  it('returns empty issues when SDK throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('timeout'))
    const result = await runner.analyzeArtifacts(['/workspace/app.ts'], '/workspace')
    expect(result.issues).toEqual([])
  })

  it('skips files where validatePath throws', async () => {
    mockValidatePath.mockRejectedValueOnce(new Error('경로 거부'))
    const result = await runner.analyzeArtifacts(['/etc/passwd'], '/workspace')
    expect(result.issues).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('skips files where readFile throws', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never)
    const result = await runner.analyzeArtifacts(['/workspace/missing.ts'], '/workspace')
    expect(result.issues).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
