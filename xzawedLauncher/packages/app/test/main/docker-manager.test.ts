import { describe, it, expect, vi, beforeEach } from 'vitest'

const execMock = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (cmd: string, cb: (e: Error | null, r: { stdout: string }) => void) =>
    execMock(cmd, cb),
  spawn: vi.fn(() => ({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() })),
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, app: { getAppPath: vi.fn(() => '/app') } }))

let dm: typeof import('../../src/main/docker-manager.js')

beforeEach(async () => {
  vi.resetModules()
  dm = await import('../../src/main/docker-manager.js')
})

describe('DockerManager', () => {
  it('checkDocker returns running when docker info exits 0', async () => {
    execMock.mockImplementation((_cmd: string, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: 'Server: Docker Engine' })
    )
    const status = await dm.checkDocker()
    expect(status).toBe('running')
  })

  it('checkDocker returns not-installed when exec errors', async () => {
    execMock.mockImplementation((_cmd: string, cb: (e: Error) => void) =>
      cb(new Error('not found'))
    )
    const status = await dm.checkDocker()
    expect(status).toBe('not-installed')
  })
})
