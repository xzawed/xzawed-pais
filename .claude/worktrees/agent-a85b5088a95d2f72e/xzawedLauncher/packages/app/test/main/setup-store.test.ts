import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/xzawed-launcher-test') }, // NOSONAR
  safeStorage: {
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
}))

let setupStore: typeof import('../../src/main/setup-store.js')

beforeEach(async () => {
  vi.resetModules()
  setupStore = await import('../../src/main/setup-store.js')
})

describe('SetupStore', () => {
  it('isSetupComplete returns false when file absent', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(setupStore.isSetupComplete()).toBe(false)
  })

  it('getSetupConfig returns null when file absent', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(setupStore.getSetupConfig()).toBeNull()
  })

  it('saveSetupConfig writes JSON to userData path', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    setupStore.saveSetupConfig({ claudeMode: 'cli', completedAt: '2026-01-01T00:00:00Z' })
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('setup-complete.json'),
      expect.stringContaining('"claudeMode":"cli"')
    )
  })
})
