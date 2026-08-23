import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Security, calculateScore, filterBySeverity } from './security.js'
import type { ManagerToSecurityMessage, SecurityIssue } from './types.js'

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockAnalyzeArtifacts = vi.fn().mockResolvedValue({ issues: [] })
/** analyzeFilesWithStats 형태 — 이슈와 "얼마나 실제로 검사했는지"를 함께 낸다. */
const staticStats = (issues: unknown[] = [], requested = issues.length, scanned = requested) => ({
  issues,
  requested,
  scanned,
  skippedByReason: { path: 0, stat: 0, oversize: 0, read: 0, analyzerError: 0 },
})
/** auditDeps 형태 — 감사 수행 여부를 함께 낸다. */
const depsOk = (issues: unknown[] = []) => ({ issues, status: 'ok' as const, tool: 'npm' as const })

const mockStaticAnalyze = vi.fn().mockResolvedValue(staticStats())
const mockDepsAudit = vi.fn().mockResolvedValue(depsOk())

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
  mockAnalyzeArtifacts.mockResolvedValue({ issues: [] })
  mockStaticAnalyze.mockResolvedValue(staticStats())
  mockDepsAudit.mockResolvedValue(depsOk())
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
      { id: 'x', severity: 'critical', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    ]
    expect(calculateScore(issues)).toBe(60)
  })

  it('deducts 15 per high issue', () => {
    const issues: SecurityIssue[] = [
      { id: 'x', severity: 'high', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    ]
    expect(calculateScore(issues)).toBe(85)
  })

  it('deducts 5 per medium and 1 per low', () => {
    const medium: SecurityIssue = { id: 'x', severity: 'medium', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' }
    const low: SecurityIssue = { id: 'y', severity: 'low', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' }
    expect(calculateScore([medium, low])).toBe(94)
  })

  it('clamps to 0 for many critical issues', () => {
    const issues: SecurityIssue[] = Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`,
      severity: 'critical' as const,
      source: 'static' as const,
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
    { id: 'l', severity: 'low', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    { id: 'm', severity: 'medium', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    { id: 'h', severity: 'high', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' },
    { id: 'cr', severity: 'critical', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' },
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
    const staticIssue: SecurityIssue = { id: 'S-1', severity: 'high', source: 'static', category: 'xss', file: 'f', description: 'd', suggestion: 's' }
    const depsIssue: SecurityIssue = { id: 'D-1', severity: 'medium', source: 'deps', category: 'dep', file: 'f', description: 'd', suggestion: 's' }
    const claudeIssue: SecurityIssue = { id: 'C-1', severity: 'low', source: 'llm', category: 'config', file: 'f', description: 'd', suggestion: 's' }

    mockStaticAnalyze.mockResolvedValueOnce(staticStats([staticIssue]))
    mockDepsAudit.mockResolvedValueOnce(depsOk([depsIssue]))
    mockAnalyzeArtifacts.mockResolvedValueOnce({ issues: [claudeIssue], knowledge: ['외부 입력은 검증'] })

    await security.handle(makeRequest({ severity: 'low' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg).toBeDefined()
    expect(msg.payload.issues).toHaveLength(3)
    expect(msg.payload.knowledge).toEqual(['외부 입력은 검증'])
  })

  it('filters reported issues by severity but scores all', async () => {
    const low: SecurityIssue = { id: 'L-1', severity: 'low', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' }
    const high: SecurityIssue = { id: 'H-1', severity: 'high', source: 'static', category: 'c', file: 'f', description: 'd', suggestion: 's' }

    mockStaticAnalyze.mockResolvedValueOnce(staticStats([low, high]))

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
    const depsIssue: SecurityIssue = { id: 'D-1', severity: 'high', source: 'deps', category: 'dep', file: 'f', description: 'd', suggestion: 's' }
    mockDepsAudit.mockResolvedValueOnce(depsOk([depsIssue]))

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
    const staticIssue: SecurityIssue = { id: 'S-1', severity: 'high', source: 'static', category: 'xss', file: 'f', description: 'd', suggestion: 's' }
    mockStaticAnalyze.mockResolvedValueOnce(staticStats([staticIssue]))
    mockDepsAudit.mockRejectedValueOnce(new Error('deps error'))

    await security.handle(makeRequest({ severity: 'low' }))

    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg.type).toBe('audit_complete')
    expect(msg.payload.issues).toHaveLength(1)
    expect(msg.payload.issues[0].id).toBe('S-1')
  })

  it('claude 분석기가 실패하면 빈 배열로 대체한다', async () => {
    const staticIssue: SecurityIssue = { id: 'S-2', severity: 'medium', source: 'static', category: 'config', file: 'f', description: 'd', suggestion: 's' }
    mockStaticAnalyze.mockResolvedValueOnce(staticStats([staticIssue]))
    mockAnalyzeArtifacts.mockRejectedValueOnce(new Error('claude error'))

    await security.handle(makeRequest({ severity: 'low' }))

    const msg = mockPublish.mock.calls[0]?.[1] as any
    expect(msg.type).toBe('audit_complete')
    expect(msg.payload.issues).toHaveLength(1)
    expect(msg.payload.issues[0].id).toBe('S-2')
  })
})

describe('감사 불능과 취약점 없음의 구분', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const published = () => mockPublish.mock.calls[0]?.[1] as any

  it('정상 감사는 auditable 로 "실제로 검사했음"을 보고한다', async () => {
    mockStaticAnalyze.mockResolvedValueOnce(staticStats([], 3, 3))
    await security.handle(makeRequest())

    const a = published().payload.auditable
    expect(a.static).toEqual({
      requested: 3, scanned: 3,
      skippedByReason: { path: 0, stat: 0, oversize: 0, read: 0, analyzerError: 0 },
    })
    expect(a.deps.status).toBe('ok')
    expect(published().payload.summary).not.toContain('감사 불능')
  })

  it('대상이 있는데 한 건도 스캔 못 하면 summary 가 감사 불능을 말한다', async () => {
    mockStaticAnalyze.mockResolvedValueOnce({
      issues: [], requested: 5, scanned: 0,
      skippedByReason: { path: 5, stat: 0, oversize: 0, read: 0, analyzerError: 0 },
    })
    await security.handle(makeRequest())

    const p = published().payload
    expect(p.auditable.static).toMatchObject({ requested: 5, scanned: 0 })
    expect(p.auditable.static.skippedByReason.path).toBe(5)
    expect(p.summary).toContain('감사 불능')
    expect(p.summary).toContain('static 미스캔')
    // 이슈 0건인데도 "안전"으로 읽히지 않아야 한다는 것이 이 슬라이스의 요점이다.
    expect(p.issues).toEqual([])
  })

  it('deps 감사 불능은 summary 에 사유와 함께 드러난다', async () => {
    mockDepsAudit.mockResolvedValueOnce({
      issues: [], status: 'unavailable', tool: 'npm', reason: 'npm_exec',
    })
    await security.handle(makeRequest())

    const p = published().payload
    expect(p.auditable.deps).toEqual({ status: 'unavailable', tool: 'npm', reason: 'npm_exec' })
    expect(p.summary).toContain('deps 감사 불능(npm_exec)')
  })

  it('package.json 비대상은 감사 불능으로 표시하지 않는다', async () => {
    // 이 저장소 자신이 루트에 package.json 이 없다 — 비대상을 실패로 접으면
    // 매 감사가 "감사 불능"으로 오염된다.
    mockDepsAudit.mockResolvedValueOnce({
      issues: [], status: 'not_applicable', tool: null, reason: 'no_package_json',
    })
    await security.handle(makeRequest())

    const p = published().payload
    expect(p.auditable.deps.status).toBe('not_applicable')
    expect(p.summary).not.toContain('감사 불능')
  })

  it('대상이 0건이면 감사 불능이 아니다 — 정상적으로 검사할 것이 없었다', async () => {
    mockStaticAnalyze.mockResolvedValueOnce(staticStats([], 0, 0))
    await security.handle(makeRequest())

    expect(published().payload.summary).not.toContain('감사 불능')
  })

  it('분석기가 rejected 되면 무음으로 빈 결과가 되지 않고 감사 불능으로 표기된다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockDepsAudit.mockRejectedValueOnce(new Error('boom'))
    await security.handle(makeRequest())

    const p = published().payload
    expect(p.auditable.deps.status).toBe('unavailable')
    expect(p.auditable.deps.reason).toBe('analyzer_error')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
})
