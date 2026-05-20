import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s + '-enc')),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/-enc$/, '')),
  },
  app: { getPath: vi.fn(() => '/tmp/test-userData') }, // NOSONAR
}))

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}))
vi.mock('node:fs', () => mockFs)

import {
  readEncryptedToken,
  writeEncryptedToken,
  deleteFileIfExists,
  getTokenPath,
  getRefreshTokenPath,
} from '../../src/main/token-storage-main.js'

describe('token-storage-main', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getTokenPath / getRefreshTokenPath', () => {
    it('userData 경로에 파일명을 붙여 반환한다', () => {
      expect(getTokenPath()).toBe(join('/tmp/test-userData', 'auth-token.enc'))
      expect(getRefreshTokenPath()).toBe(join('/tmp/test-userData', 'refresh-token.enc'))
    })
  })

  describe('readEncryptedToken', () => {
    it('파일이 없으면 null 반환', () => {
      mockFs.existsSync.mockReturnValue(false)
      expect(readEncryptedToken('/tmp/test-userData/auth-token.enc')).toBeNull()
    })

    it('암호화 가능할 때 복호화 후 반환', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(Buffer.from('secret-enc'))
      const result = readEncryptedToken('/tmp/test-userData/auth-token.enc')
      expect(result).toBe('secret')
    })

    it('암호화 불가 시 UTF-8 문자열로 반환', async () => {
      const { safeStorage } = await import('electron')
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(Buffer.from('plain-token', 'utf-8'))
      const result = readEncryptedToken('/tmp/test-userData/auth-token.enc')
      expect(result).toBe('plain-token')
    })

    it('readFileSync 예외 시 null 반환', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation(() => { throw new Error('read error') })
      expect(readEncryptedToken('/tmp/test-userData/auth-token.enc')).toBeNull()
    })
  })

  describe('writeEncryptedToken', () => {
    it('userData 디렉토리가 없으면 생성 후 파일 저장', () => {
      mockFs.existsSync.mockReturnValue(false)
      writeEncryptedToken(join('/tmp/test-userData', 'auth-token.enc'), 'my-token')
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/tmp/test-userData', { recursive: true })
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })

    it('디렉토리 존재 시 mkdirSync 미호출', () => {
      mockFs.existsSync.mockReturnValue(true)
      writeEncryptedToken(join('/tmp/test-userData', 'auth-token.enc'), 'my-token')
      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('deleteFileIfExists', () => {
    it('파일이 있으면 삭제', () => {
      mockFs.existsSync.mockReturnValue(true)
      const filePath = join('/tmp/test-userData', 'auth-token.enc')
      deleteFileIfExists(filePath)
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(filePath)
    })

    it('파일이 없으면 unlinkSync 미호출', () => {
      mockFs.existsSync.mockReturnValue(false)
      deleteFileIfExists('/tmp/test-userData/auth-token.enc')
      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
    })

    it('unlinkSync 예외 시 무시', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.unlinkSync.mockImplementation(() => { throw new Error('delete error') })
      expect(() => deleteFileIfExists('/tmp/test-userData/auth-token.enc')).not.toThrow()
    })
  })
})
