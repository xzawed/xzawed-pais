import { describe, it, expect, vi, beforeEach } from 'vitest'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

function makeSpawnResult(stdout: string, exitCode = 0) {
  const stdoutHandlers: ((d: Buffer) => void)[] = []
  const closeHandlers: ((code: number) => void)[] = []
  const proc = {
    stdout: { on: vi.fn((event: string, cb: (d: Buffer) => void) => { if (event === 'data') stdoutHandlers.push(cb) }) },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: ((code: number) => void) | ((e: Error) => void)) => {
      if (event === 'close') closeHandlers.push(cb as (code: number) => void)
    }),
  }
  setTimeout(() => {
    stdoutHandlers.forEach((h) => h(Buffer.from(stdout)))
    closeHandlers.forEach((h) => h(exitCode))
  }, 0)
  return proc
}

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
    spawnMock.mockImplementation(() => makeSpawnResult('', 1))
    expect(await cd.checkClaude()).toBe('not-installed')
  })
})
