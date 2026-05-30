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

describe('static-injection rules', () => {
  it('S012: detects exec with template literal', async () => {
    mockReadFile.mockResolvedValueOnce('exec(`rm -rf ${userPath}`)' as never)
    const issues = await analyzeFiles(['/workspace/cmd.ts'], '/workspace')
    const s012 = issues.find((i) => i.id.startsWith('S012'))
    expect(s012).toBeDefined()
    expect(s012?.severity).toBe('high')
    expect(s012?.cwe).toBe('CWE-78')
  })

  it('S012: detects execSync with template literal', async () => {
    mockReadFile.mockResolvedValueOnce('execSync(`git commit -m ${msg}`)' as never)
    const issues = await analyzeFiles(['/workspace/git.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S012'))).toBe(true)
  })

  it('S012: does not flag spawn with args array', async () => {
    mockReadFile.mockResolvedValueOnce("spawn('rm', ['-rf', userPath], { shell: false })" as never)
    const issues = await analyzeFiles(['/workspace/cmd.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S012'))).toBe(false)
  })

  it('S013: detects new Function()', async () => {
    mockReadFile.mockResolvedValueOnce("const fn = new Function('return 1 + 1')" as never)
    const issues = await analyzeFiles(['/workspace/dynamic.ts'], '/workspace')
    const s013 = issues.find((i) => i.id.startsWith('S013'))
    expect(s013).toBeDefined()
    expect(s013?.severity).toBe('high')
    expect(s013?.cwe).toBe('CWE-94')
  })

  it('S013: does not flag regular function declaration', async () => {
    mockReadFile.mockResolvedValueOnce('function add(a, b) { return a + b }' as never)
    const issues = await analyzeFiles(['/workspace/utils.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S013'))).toBe(false)
  })

  it('returns no injection issues for clean code', async () => {
    mockReadFile.mockResolvedValueOnce("spawn('node', ['script.js'], { shell: false })" as never)
    const issues = await analyzeFiles(['/workspace/clean.ts'], '/workspace')
    const injectionIssues = issues.filter((i) => ['S012', 'S013'].some((id) => i.id.startsWith(id)))
    expect(injectionIssues).toHaveLength(0)
  })
})
