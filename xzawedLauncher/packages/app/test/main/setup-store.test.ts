import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/xzawed-launcher-test') }, // NOSONAR
}))

let setupStore: typeof import('../../src/main/setup-store.js')

beforeEach(async () => {
  vi.resetModules()
  setupStore = await import('../../src/main/setup-store.js')
})

describe('SetupStore', () => {
  it('isComplete returns false when file absent', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(await setupStore.isSetupComplete()).toBe(false)
  })

  it('isComplete returns true when file exists', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ claudeMode: 'cli', completedAt: '2026-01-01T00:00:00Z' })
    )
    expect(await setupStore.isSetupComplete()).toBe(true)
  })

  it('saveConfig writes JSON to userData path', async () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    await setupStore.saveSetupConfig({ claudeMode: 'cli', completedAt: '2026-01-01T00:00:00Z' })
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('setup-complete.json'),
      expect.stringContaining('"claudeMode":"cli"')
    )
  })
})
