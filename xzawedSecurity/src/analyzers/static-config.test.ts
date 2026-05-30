import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn(), stat: vi.fn() },
}))

vi.mock('../executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}))

import fs from 'node:fs/promises'
import { analyzeFiles } from './static.js'

const mockReadFile = vi.mocked(fs.readFile)
const mockStat = vi.mocked(fs.stat)

beforeEach(() => {
  vi.clearAllMocks()
  mockStat.mockResolvedValue({ size: 100 } as never)
})

describe('static-config rules', () => {
  it('S009: detects CORS wildcard origin', async () => {
    mockReadFile.mockResolvedValueOnce("cors({ origin: '*' })" as never)
    const issues = await analyzeFiles(['/workspace/server.ts'], '/workspace')
    const s009 = issues.find((i) => i.id.startsWith('S009'))
    expect(s009).toBeDefined()
    expect(s009?.severity).toBe('medium')
    expect(s009?.cwe).toBe('CWE-942')
  })

  it('S009: does not flag explicit origin', async () => {
    mockReadFile.mockResolvedValueOnce("cors({ origin: 'https://example.com' })" as never)
    const issues = await analyzeFiles(['/workspace/server.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S009'))).toBe(false)
  })

  it('S010: detects TLS verification disabled', async () => {
    mockReadFile.mockResolvedValueOnce("process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'" as never)
    const issues = await analyzeFiles(['/workspace/tls.ts'], '/workspace')
    const s010 = issues.find((i) => i.id.startsWith('S010'))
    expect(s010).toBeDefined()
    expect(s010?.severity).toBe('high')
    expect(s010?.cwe).toBe('CWE-295')
  })

  it('S010: does not flag value of 1', async () => {
    mockReadFile.mockResolvedValueOnce("process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'" as never)
    const issues = await analyzeFiles(['/workspace/tls.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S010'))).toBe(false)
  })

  it('S011: detects stack trace in response', async () => {
    mockReadFile.mockResolvedValueOnce('res.json({ error: err.stack })' as never)
    const issues = await analyzeFiles(['/workspace/handler.ts'], '/workspace')
    const s011 = issues.find((i) => i.id.startsWith('S011'))
    expect(s011).toBeDefined()
    expect(s011?.severity).toBe('medium')
    expect(s011?.cwe).toBe('CWE-209')
  })

  it('S011: does not flag safe error response', async () => {
    mockReadFile.mockResolvedValueOnce("res.json({ error: 'Internal Server Error' })" as never)
    const issues = await analyzeFiles(['/workspace/handler.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S011'))).toBe(false)
  })

  it('returns no config issues for clean code', async () => {
    mockReadFile.mockResolvedValueOnce("cors({ origin: ['https://app.com'] })" as never)
    const issues = await analyzeFiles(['/workspace/clean.ts'], '/workspace')
    const configIssues = issues.filter((i) => ['S009', 'S010', 'S011'].some((id) => i.id.startsWith(id)))
    expect(configIssues).toHaveLength(0)
  })
})
