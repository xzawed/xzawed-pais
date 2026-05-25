import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Security, calculateScore, filterBySeverity } from './security.js'
import type { ManagerToSecurityMessage, SecurityIssue } from './types.js'

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockAnalyzeArtifacts = vi.fn().mockResolvedValue([])
const mockStaticAnalyze = vi.fn().mockResolvedValue([])
const mockDepsAudit = vi.fn().mockResolvedValue([])

const config = {
  anthropicApiKey: 'sk-test',
  claudeModel: 'claude-test',
  redisUrl: 'redis://localhost:6379',
  port: 3008,
  mode: 'local' as const,
  workspaceRoot: '/workspace',
}

function makeRequest(
  overrides?: Partial<ManagerToSecurityMessage['payload']>,
): ManagerToSecurityMessage {
  return {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'audit_request',
    payload: {
      artifacts: ['/workspace/app.ts'],
      projectPath: '/workspace/app',
      severity: 'medium',
      context: {},
      ...overrides,
    },
  }
}

let security: Security

beforeEach(() => {
  vi.clearAllMocks()
  mockPublish.mockResolvedValue(undefined)
  mockAnalyzeArtifacts.mockResolvedValue([])
  mockStaticAnalyze.mockResolvedValue([])
  mockDepsAudit.mockResolvedValue([])
  security = new Security(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { publish: mockPublish } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { analyzeArtifacts: mockAnalyzeArtifacts } as any,
    config,
    mockStaticAnalyze,
    mockDepsAudit,
  )
})

describe('calculateScore', () => {
  it('returns 100 for no issues', () => {
    expect(calculateScore([])).toBe(100)
  })

  it('deducts 40 per critical issue', () => {
    const issues: SecurityIssue[] = [
      { id: 'x', severity: 'critical', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    ]
    expect(calculateScore(issues)).toBe(60)
  })

  it('deducts 15 per high issue', () => {
    const issues: SecurityIssue[] = [
      { id: 'x', severity: 'high', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    ]
    expect(calculateScore(issues)).toBe(85)
  })

  it('deducts 5 per medium and 1 per low', () => {
    const medium: SecurityIssue = { id: 'x', severity: 'medium', category: 'c', file: 'f', description: 'd', suggestion: 's' }
    const low: SecurityIssue = { id: 'y', severity: 'low', category: 'c', file: 'f', description: 'd', suggestion: 's' }
    expect(calculateScore([medium, low])).toBe(94)
  })

  it('clamps to 0 for many critical issues', () => {
    const issues: SecurityIssue[] = Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`,
      severity: 'critical' as const,
      category: 'c',
      file: 'f',
      description: 'd',
      suggestion: 's',
    }))
    expect(calculateScore(issues)).toBe(0)
  })
})

describe('filterBySeverity', () => {
  const issues: SecurityIssue[] = [
    { id: 'l', severity: 'low', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    { id: 'm', severity: 'medium', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    { id: 'h', severity: 'high', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    { id: 'cr', severity: 'critical', category: 'c', file: 'f', description: 'd', suggestion: 's' },
  ]

  it('low includes all', () => {
    expect(filterBySeverity(issues, 'low')).toHaveLength(4)
  })

  it('medium excludes low', () => {
    const result = filterBySeverity(issues, 'medium')
    expect(result).toHaveLength(3)
    expect(result.find((i) => i.id === 'l')).toBeUndefined()
  })

  it('high includes only high and critical', () => {
    const result = filterBySeverity(issues, 'high')
    expect(result).toHaveLength(2)
    expect(result.map((i) => i.id).sort((a, b) => a.localeCompare(b))).toEqual(['cr', 'h'])
  })
})

describe('Security.handle', () => {
  it('publishes audit_complete on success', async () => {
    await security.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'audit_complete',
        payload: expect.objectContaining({ score: 100 }),
      }),
    )
  })

  it('returns immediately on abort', async () => {
    const abort: ManagerToSecurityMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-2',
      timestamp: Date.now(),
      type: 'abort',
      payload: { artifacts: [], projectPath: '', severity: 'medium', context: {} },
    }
    await security.handle(abort)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('merges issues from all three analyzers', async () => {
    const staticIssue: SecurityIssue = { id: 'S-1', severity: 'high', category: 'xss', file: 'f', description: 'd', suggestion: 's' }
    const depsIssue: SecurityIssue = { id: 'D-1', severity: 'medium', category: 'dep', file: 'f', description: 'd', suggestion: 's' }
    const claudeIssue: SecurityIssue = { id: 'C-1', severity: 'low', category: 'config', file: 'f', description: 'd', suggestion: 's' }

    mockStaticAnalyze.mockResolvedValueOnce([staticIssue])
    mockDepsAudit.mockResolvedValueOnce([depsIssue])
    mockAnalyzeArtifacts.mockResolvedValueOnce([claudeIssue])

    await security.handle(makeRequest({ severity: 'low' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg).toBeDefined()
    expect(msg.payload.issues).toHaveLength(3)
  })

  it('filters reported issues by severity but scores all', async () => {
    const low: SecurityIssue = { id: 'L-1', severity: 'low', category: 'c', file: 'f', description: 'd', suggestion: 's' }
    const high: SecurityIssue = { id: 'H-1', severity: 'high', category: 'c', file: 'f', description: 'd', suggestion: 's' }

    mockStaticAnalyze.mockResolvedValueOnce([low, high])

    await security.handle(makeRequest({ severity: 'high' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = mockPublish.mock.calls[0]?.[1] as any
    // only high is reported
    expect(msg.payload.issues).toHaveLength(1)
    expect(msg.payload.issues[0].id).toBe('H-1')
    // score reflects both issues: 100 - 15 - 1 = 84
    expect(msg.payload.score).toBe(84)
  })

  it('continues if one analyzer fails', async () => {
    mockStaticAnalyze.mockRejectedValueOnce(new Error('static error'))
    const depsIssue: SecurityIssue = { id: 'D-1', severity: 'high', category: 'dep', file: 'f', description: 'd', suggestion: 's' }
    mockDepsAudit.mockResolvedValueOnce([depsIssue])

    await security.handle(makeRequest({ severity: 'low' }))
    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'audit_complete' }),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg.payload.issues).toHaveLength(1)
  })

  it('publishes error when producer throws', async () => {
    mockStaticAnalyze.mockRejectedValueOnce(new Error('boom'))
    mockDepsAudit.mockRejectedValueOnce(new Error('boom'))
    mockAnalyzeArtifacts.mockRejectedValueOnce(new Error('boom'))
    mockPublish.mockResolvedValueOnce(undefined) // error publish succeeds
    await security.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalled()
  })

  it('3개 분석기 모두 실패하면 error 메시지를 발행한다', async () => {
    mockStaticAnalyze.mockRejectedValueOnce(new Error('static failed'))
    mockDepsAudit.mockRejectedValueOnce(new Error('deps failed'))
    mockAnalyzeArtifacts.mockRejectedValueOnce(new Error('claude failed'))

    await security.handle(makeRequest())

    expect(mockPublish).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'error' }),
    )
    // audit_complete가 발행되지 않아야 한다
    const calls = mockPublish.mock.calls.map(([, msg]: [unknown, { type: string }]) => msg.type)
    expect(calls).not.toContain('audit_complete')
  })

  it('deps 분석기가 실패하면 빈 배열로 대체한다', async () => {
    const staticIssue: SecurityIssue = { id: 'S-1', severity: 'high', category: 'xss', file: 'f', description: 'd', suggestion: 's' }
    mockStaticAnalyze.mockResolvedValueOnce([staticIssue])
    mockDepsAudit.mockRejectedValueOnce(new Error('deps error'))

    await security.handle(makeRequest({ severity: 'low' }))

    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg.type).toBe('audit_complete')
    expect(msg.payload.issues).toHaveLength(1)
    expect(msg.payload.issues[0].id).toBe('S-1')
  })

  it('claude 분석기가 실패하면 빈 배열로 대체한다', async () => {
    const staticIssue: SecurityIssue = { id: 'S-2', severity: 'medium', category: 'config', file: 'f', description: 'd', suggestion: 's' }
    mockStaticAnalyze.mockResolvedValueOnce([staticIssue])
    mockAnalyzeArtifacts.mockRejectedValueOnce(new Error('claude error'))

    await security.handle(makeRequest({ severity: 'low' }))

    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg.type).toBe('audit_complete')
    expect(msg.payload.issues).toHaveLength(1)
    expect(msg.payload.issues[0].id).toBe('S-2')
  })
})
