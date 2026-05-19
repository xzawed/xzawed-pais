import { describe, it, expect, vi, beforeEach } from 'vitest'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getAppPath: vi.fn(() => '/app') },
}))

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
  // Emit stdout and close asynchronously
  setTimeout(() => {
    stdoutHandlers.forEach((h) => h(Buffer.from(stdout)))
    closeHandlers.forEach((h) => h(exitCode))
  }, 0)
  return proc
}

let dm: typeof import('../../src/main/docker-manager.js')

beforeEach(async () => {
  vi.resetModules()
  spawnMock.mockReset()
  dm = await import('../../src/main/docker-manager.js')
})

describe('DockerManager', () => {
  it('checkDocker returns running when docker info output includes Server', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('Server: Docker Engine'))
    const status = await dm.checkDocker()
    expect(status).toBe('running')
  })

  it('checkDocker returns not-installed when both docker info and docker --version fail', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('', 1))
    const status = await dm.checkDocker()
    expect(status).toBe('not-installed')
  })

  it('validateServiceName throws for unknown service', () => {
    expect(() => dm.validateServiceName('evil; rm -rf /')).toThrow('Invalid service name')
  })

  it('validateServiceName returns name for valid service', () => {
    expect(dm.validateServiceName('redis')).toBe('redis')
  })
})
