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

describe('static-traversal rules', () => {
  it('S014: detects path.join with user input', async () => {
    mockReadFile.mockResolvedValueOnce('path.join(root, req.params.file)' as never)
    const issues = await analyzeFiles(['/workspace/download.ts'], '/workspace')
    const s014 = issues.find((i) => i.id.startsWith('S014'))
    expect(s014).toBeDefined()
    expect(s014?.severity).toBe('high')
    expect(s014?.cwe).toBe('CWE-22')
  })

  it('S014: detects path.resolve with query input', async () => {
    mockReadFile.mockResolvedValueOnce('path.resolve(root, req.query.dir)' as never)
    const issues = await analyzeFiles(['/workspace/files.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S014'))).toBe(true)
  })

  it('S014: does not flag path.join with static args', async () => {
    mockReadFile.mockResolvedValueOnce("path.join(__dirname, 'static', 'index.html')" as never)
    const issues = await analyzeFiles(['/workspace/serve.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S014'))).toBe(false)
  })

  it('S015: detects fetch with user-supplied URL', async () => {
    mockReadFile.mockResolvedValueOnce('fetch(req.query.url)' as never)
    const issues = await analyzeFiles(['/workspace/proxy.ts'], '/workspace')
    const s015 = issues.find((i) => i.id.startsWith('S015'))
    expect(s015).toBeDefined()
    expect(s015?.severity).toBe('high')
    expect(s015?.cwe).toBe('CWE-918')
  })

  it('S015: does not flag fetch with static URL', async () => {
    mockReadFile.mockResolvedValueOnce("fetch('https://api.example.com/data')" as never)
    const issues = await analyzeFiles(['/workspace/api.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S015'))).toBe(false)
  })

  it('S016: detects file:// protocol usage', async () => {
    mockReadFile.mockResolvedValueOnce("const url = 'file:///etc/passwd'" as never)
    const issues = await analyzeFiles(['/workspace/file.ts'], '/workspace')
    const s016 = issues.find((i) => i.id.startsWith('S016'))
    expect(s016).toBeDefined()
    expect(s016?.severity).toBe('medium')
    expect(s016?.cwe).toBe('CWE-73')
  })

  it('S016: does not flag https URL', async () => {
    mockReadFile.mockResolvedValueOnce("const url = 'https://example.com'" as never)
    const issues = await analyzeFiles(['/workspace/safe.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S016'))).toBe(false)
  })

  it('returns no traversal issues for clean code', async () => {
    mockReadFile.mockResolvedValueOnce('const safePath = path.join(root, path.basename(input))' as never)
    const issues = await analyzeFiles(['/workspace/clean.ts'], '/workspace')
    const traversalIssues = issues.filter((i) => ['S014', 'S015', 'S016'].some((id) => i.id.startsWith(id)))
    expect(traversalIssues).toHaveLength(0)
  })
})
