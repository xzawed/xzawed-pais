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

describe('static-crypto rules', () => {
  it('S006: detects MD5 hash usage', async () => {
    mockReadFile.mockResolvedValueOnce('crypto.createHash("md5")' as never)
    const issues = await analyzeFiles(['/workspace/hash.ts'], '/workspace')
    const s006 = issues.find((i) => i.id.startsWith('S006'))
    expect(s006).toBeDefined()
    expect(s006?.severity).toBe('high')
    expect(s006?.cwe).toBe('CWE-327')
  })

  it('S006: does not flag sha256', async () => {
    mockReadFile.mockResolvedValueOnce("crypto.createHash('sha256')" as never)
    const issues = await analyzeFiles(['/workspace/hash.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S006'))).toBe(false)
  })

  it('S007: detects SHA1 hash usage', async () => {
    mockReadFile.mockResolvedValueOnce("crypto.createHash('sha1')" as never)
    const issues = await analyzeFiles(['/workspace/hash.ts'], '/workspace')
    const s007 = issues.find((i) => i.id.startsWith('S007'))
    expect(s007).toBeDefined()
    expect(s007?.severity).toBe('medium')
    expect(s007?.cwe).toBe('CWE-327')
  })

  it('S007: does not flag sha512', async () => {
    mockReadFile.mockResolvedValueOnce("crypto.createHash('sha512')" as never)
    const issues = await analyzeFiles(['/workspace/hash.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S007'))).toBe(false)
  })

  it('S008: detects AES-ECB mode usage', async () => {
    mockReadFile.mockResolvedValueOnce("createCipheriv('aes-256-ecb', key, iv)" as never)
    const issues = await analyzeFiles(['/workspace/cipher.ts'], '/workspace')
    const s008 = issues.find((i) => i.id.startsWith('S008'))
    expect(s008).toBeDefined()
    expect(s008?.severity).toBe('high')
    expect(s008?.cwe).toBe('CWE-327')
  })

  it('S008: does not flag AES-GCM', async () => {
    mockReadFile.mockResolvedValueOnce("createCipheriv('aes-256-gcm', key, iv)" as never)
    const issues = await analyzeFiles(['/workspace/cipher.ts'], '/workspace')
    expect(issues.some((i) => i.id.startsWith('S008'))).toBe(false)
  })

  it('returns no crypto issues for clean code', async () => {
    mockReadFile.mockResolvedValueOnce("crypto.createHash('sha256').update(data).digest('hex')" as never)
    const issues = await analyzeFiles(['/workspace/clean.ts'], '/workspace')
    const cryptoIssues = issues.filter((i) => ['S006', 'S007', 'S008'].some((id) => i.id.startsWith(id)))
    expect(cryptoIssues).toHaveLength(0)
  })
})
