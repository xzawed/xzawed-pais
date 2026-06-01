import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSpawnResult } from './_helpers.js'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

let cd: typeof import('../../src/main/claude-detector.js')

beforeEach(async () => {
  vi.resetModules()
  spawnMock.mockReset()
  cd = await import('../../src/main/claude-detector.js')
})

describe('ClaudeDetector', () => {
  it('checkClaude returns logged-in when whoami succeeds with email', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('user@example.com'))
    expect(await cd.checkClaude()).toBe('logged-in')
  })

  it('checkClaude returns not-logged-in when whoami says Not logged in', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('Not logged in'))
    expect(await cd.checkClaude()).toBe('not-logged-in')
  })

  it('checkClaude returns not-installed when claude spawn fails', async () => {
    spawnMock.mockImplementation(function () { return makeSpawnResult('', 1) })
    expect(await cd.checkClaude()).toBe('not-installed')
  })
})
