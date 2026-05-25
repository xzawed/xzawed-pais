import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  readToken,
  writeToken,
  readRefreshToken,
  writeRefreshToken,
  clearTokenFiles,
} from '../../src/main/token-storage-main.js'

describe('token-storage-main', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('readToken / readRefreshToken', () => {
    it('파일이 없으면 null 반환', () => {
      mockFs.existsSync.mockReturnValue(false)
      expect(readToken()).toBeNull()
      expect(readRefreshToken()).toBeNull()
    })

    it('암호화 가능할 때 복호화 후 반환', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(Buffer.from('secret-enc'))
      expect(readToken()).toBe('secret')
    })

    it('암호화 불가 시 UTF-8 문자열로 반환', async () => {
      const { safeStorage } = await import('electron')
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(Buffer.from('plain-token', 'utf-8'))
      expect(readToken()).toBe('plain-token')
    })

    it('읽기 실패 시 null 반환', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation(() => { throw new Error('read error') })
      expect(readToken()).toBeNull()
    })
  })

  describe('writeToken / writeRefreshToken', () => {
    it('userData 디렉토리가 없으면 생성 후 파일 저장', () => {
      mockFs.existsSync.mockReturnValue(false)
      writeToken('my-token')
      expect(mockFs.mkdirSync).toHaveBeenCalled()
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })

    it('디렉토리 존재 시 mkdirSync 미호출', () => {
      mockFs.existsSync.mockReturnValue(true)
      writeToken('my-token')
      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('clearTokenFiles', () => {
    it('두 토큰 파일을 삭제한다', () => {
      mockFs.existsSync.mockReturnValue(true)
      clearTokenFiles()
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2)
    })

    it('파일이 없으면 unlinkSync 미호출', () => {
      mockFs.existsSync.mockReturnValue(false)
      clearTokenFiles()
      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
    })

    it('unlinkSync 예외 시 무시', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.unlinkSync.mockImplementation(() => { throw new Error('delete error') })
      expect(() => clearTokenFiles()).not.toThrow()
    })
  })
})
