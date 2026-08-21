import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp/xzawed-launcher-test') }, // NOSONAR
  safeStorage: {
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
}))

const getSetupConfig = vi.fn()
vi.mock('../../src/main/setup-store.js', () => ({ getSetupConfig }))
vi.mock('../../src/main/docker-manager.js', () => ({ getServiceStatuses: vi.fn() }))

let mod: typeof import('../../src/main/service-monitor.js')

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mod = await import('../../src/main/service-monitor.js')
})

describe('getOrCreateDbPassword', () => {
  it('기존 파일이 있으면 그 값을 그대로 쓴다 — 볼륨 인증이 깨지지 않게', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('stored-pw\n' as never)
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    expect(mod.getOrCreateDbPassword()).toBe('stored-pw')
    expect(write).not.toHaveBeenCalled()
  })

  it('최초 실행이면 생성해 0600으로 저장한다', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT') })
    vi.spyOn(fs, 'mkdirSync').mockImplementation(function () { return undefined })
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    const pw = mod.getOrCreateDbPassword()
    expect(pw.length).toBeGreaterThan(20)
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('db-password'),
      pw,
      { mode: 0o600 },
    )
  })

  it('빈 파일은 최초 실행과 같이 취급한다', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('   ' as never)
    vi.spyOn(fs, 'mkdirSync').mockImplementation(function () { return undefined })
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    expect(mod.getOrCreateDbPassword().length).toBeGreaterThan(20)
    expect(write).toHaveBeenCalled()
  })
})

describe('buildDockerEnv', () => {
  it('POSTGRES_PASSWORD를 반드시 싣는다 — 없으면 compose가 보간에서 죽는다', () => {
    getSetupConfig.mockReturnValue({ claudeMode: 'cli', completedAt: 'x' })
    vi.spyOn(fs, 'readFileSync').mockReturnValue('stored-pw' as never)
    const env = mod.buildDockerEnv()
    expect(env['POSTGRES_PASSWORD']).toBe('stored-pw')
    expect(env['CLAUDE_MODE']).toBe('cli')
  })

  it('설정이 없으면 빈 객체 — 기존 동작 보존', () => {
    getSetupConfig.mockReturnValue(null)
    expect(mod.buildDockerEnv()).toEqual({})
  })

  it('api 모드면 ANTHROPIC_API_KEY도 함께 싣는다', () => {
    getSetupConfig.mockReturnValue({ claudeMode: 'api', completedAt: 'x' })
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: string) =>
      String(p).includes('api-key.enc') ? Buffer.from('enc:sk-ant-x') : 'stored-pw') as never)
    const env = mod.buildDockerEnv()
    expect(env['POSTGRES_PASSWORD']).toBe('stored-pw')
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-x')
  })
})
