import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn(), stat: vi.fn() },
}))

vi.mock('../executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}))

import fs from 'node:fs/promises'
import { validatePath } from '../executor.js'
import { analyzeFiles } from './static.js'

const mockReadFile = vi.mocked(fs.readFile)
const mockStat = vi.mocked(fs.stat)
const mockValidatePath = vi.mocked(validatePath)

beforeEach(() => {
  vi.clearAllMocks()
  mockValidatePath.mockImplementation((p: string) => Promise.resolve(p))
  // default: small file, within size limit
  mockStat.mockResolvedValue({ size: 100 } as never)
})

describe('analyzeFiles', () => {
  it('returns [] for empty file list', async () => {
    const result = await analyzeFiles([], '/workspace')
    expect(result).toEqual([])
  })

  it('detects hardcoded password (S001)', async () => {
    mockReadFile.mockResolvedValueOnce('const password = "secret123"' as never)
    const issues = await analyzeFiles(['/workspace/app.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S001'))).toBe(true)
    expect(issues[0]?.severity).toBe('critical')
    expect(issues[0]?.cwe).toBe('CWE-798')
  })

  it('detects eval usage (S003)', async () => {
    mockReadFile.mockResolvedValueOnce('eval(userInput)' as never)
    const issues = await analyzeFiles(['/workspace/eval.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S003'))).toBe(true)
    expect(issues[0]?.severity).toBe('high')
  })

  it('detects innerHTML assignment (S004)', async () => {
    mockReadFile.mockResolvedValueOnce('element.innerHTML = userContent' as never)
    const issues = await analyzeFiles(['/workspace/dom.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S004'))).toBe(true)
    expect(issues[0]?.cwe).toBe('CWE-79')
  })

  it('S005: detects SQL injection via template literal', async () => {
    mockReadFile.mockResolvedValueOnce('db.query(`SELECT * FROM users WHERE id=${userId}`)' as never)
    const issues = await analyzeFiles(['/workspace/db.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S005'))).toBe(true)
    expect(issues.find((i) => i.id.startsWith('S005'))?.severity).toBe('high')
    expect(issues.find((i) => i.id.startsWith('S005'))?.cwe).toBe('CWE-89')
  })

  it('skips file when validatePath throws', async () => {
    mockValidatePath.mockRejectedValueOnce(new Error('경로 거부'))
    const issues = await analyzeFiles(['/etc/passwd'], '/workspace')
    expect(issues).toEqual([])
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('skips file when readFile throws', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never)
    const issues = await analyzeFiles(['/workspace/missing.ts'], '/workspace')
    expect(issues).toEqual([])
  })

  it('reports correct file and line number', async () => {
    mockReadFile.mockResolvedValueOnce('line1\nconst password = "pw"\nline3' as never)
    const issues = await analyzeFiles(['/workspace/creds.ts'], '/workspace')
    expect(issues[0]?.line).toBe(2)
    expect(issues[0]?.file).toBe('/workspace/creds.ts')
  })

  it('returns no issues for clean code', async () => {
    mockReadFile.mockResolvedValueOnce('const x = 1 + 2\nconsole.log(x)' as never)
    const issues = await analyzeFiles(['/workspace/clean.ts'], '/workspace')
    expect(issues).toEqual([])
  })

  it('S017 — document.write() 탐지', async () => {
    mockReadFile.mockResolvedValueOnce('document.write("<script>alert(1)</script>")' as never)
    const issues = await analyzeFiles(['/workspace/test.ts'], '/workspace')
    expect(issues.some(i => i.id.startsWith('S017'))).toBe(true)
  })

  it('S019 — dangerouslySetInnerHTML 탐지', async () => {
    mockReadFile.mockResolvedValueOnce('return <div dangerouslySetInnerHTML={{ __html: userInput }} />' as never)
    const issues = await analyzeFiles(['/workspace/test.tsx'], '/workspace')
    expect(issues.some(i => i.id.startsWith('S019'))).toBe(true)
  })

  it('S020 — 인증 훅 없는 라우트 탐지', async () => {
    mockReadFile.mockResolvedValueOnce('app.get("/admin", async (req, reply) => { return "ok" })' as never)
    const issues = await analyzeFiles(['/workspace/test.ts'], '/workspace')
    expect(issues.some(i => i.id.startsWith('S020'))).toBe(true)
  })
})
