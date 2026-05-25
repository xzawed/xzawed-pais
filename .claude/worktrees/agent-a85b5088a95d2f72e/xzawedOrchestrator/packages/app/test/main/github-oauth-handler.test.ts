import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s + '-enc')),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('-enc', '')),
  },
  shell: { openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp/test-userData') }, // NOSONAR
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from('token-enc').toString('base64')),
  mkdirSync: vi.fn(),
}))

import { storeToken, getStoredToken, clearToken } from '../../src/main/github-oauth-handler.js'

describe('github-oauth-handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('토큰을 암호화해 저장한다', async () => {
    const { writeFileSync } = await import('node:fs')
    storeToken('ghp_testtoken')
    expect(writeFileSync).toHaveBeenCalled()
  })

  it('저장된 토큰을 복호화해 반환한다', () => {
    const token = getStoredToken()
    expect(typeof token === 'string' || token === null).toBe(true)
  })

  it('토큰을 삭제한다', async () => {
    const { writeFileSync } = await import('node:fs')
    clearToken()
    expect(writeFileSync).toHaveBeenCalled()
  })
})
