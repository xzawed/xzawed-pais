import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted로 mock 객체를 호이스팅 — vi.mock 팩토리에서 참조 가능
const mockSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
  decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/xzawed-launcher-token-test'), // NOSONAR
    getAppPath: vi.fn(() => '/app'),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
  BrowserWindow: vi.fn(() => ({
    once: vi.fn(),
    on: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(() => Promise.resolve()),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
    hide: vi.fn(),
    show: vi.fn(),
  })),
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  safeStorage: mockSafeStorage,
  shell: { openExternal: vi.fn() },
}))

const mockFs = vi.hoisted(() => ({
  readFileSync: vi.fn(() => Buffer.from('enc:test-api-key')),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: mockFs,
  ...mockFs,
}))

// token:set / token:get 핸들러 로직을 직접 추출해 테스트
// index.ts의 핸들러 로직을 인라인으로 복제하여 safeStorage 조건 분기를 검증

import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

function encKeyPath(): string {
  return path.join('/tmp/xzawed-launcher-token-test', 'api-key.enc') // NOSONAR
}

function tokenSet(key: unknown): { success: boolean; error?: string } {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
    return { success: false, error: 'Invalid key' }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: '암호화를 지원하지 않는 환경에서는 API 키를 저장할 수 없습니다.' }
  }
  try {
    const enc = safeStorage.encryptString(key)
    const p = encKeyPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, enc)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function tokenGet(): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const raw = fs.readFileSync(encKeyPath())
    return safeStorage.decryptString(raw)
  } catch { return null }
}

describe('token IPC handlers — safeStorage 보안 검증', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`))
    mockSafeStorage.decryptString.mockImplementation((b: Buffer) => b.toString().replace(/^enc:/, ''))
    mockFs.readFileSync.mockReturnValue(Buffer.from('enc:test-api-key'))
  })

  describe('token:set (writeApiKey)', () => {
    it('safeStorage 가용 시 정상 저장', () => {
      const result = tokenSet('sk-ant-test-key')
      expect(result.success).toBe(true)
      expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('sk-ant-test-key')
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })

    it('safeStorage 불가 시 저장 거부 — 에러 메시지 포함', () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
      const result = tokenSet('sk-ant-test-key')
      expect(result.success).toBe(false)
      expect(result.error).toBe('암호화를 지원하지 않는 환경에서는 API 키를 저장할 수 없습니다.')
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('빈 문자열은 Invalid key 에러', () => {
      const result = tokenSet('')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid key')
    })

    it('512자 초과는 Invalid key 에러', () => {
      const result = tokenSet('a'.repeat(513))
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid key')
    })
  })

  describe('token:get (readApiKey)', () => {
    it('safeStorage 가용 시 복호화 후 반환', () => {
      const result = tokenGet()
      expect(result).toBe('test-api-key')
      expect(mockSafeStorage.decryptString).toHaveBeenCalled()
    })

    it('safeStorage 불가 시 null 반환', () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
      const result = tokenGet()
      expect(result).toBeNull()
      expect(mockSafeStorage.decryptString).not.toHaveBeenCalled()
    })

    it('파일 읽기 실패 시 null 반환', () => {
      mockFs.readFileSync.mockImplementation(() => { throw new Error('no file') })
      const result = tokenGet()
      expect(result).toBeNull()
    })
  })
})
