import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSpawnResult } from './_helpers.js'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getAppPath: vi.fn(() => '/app') },
}))

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
    spawnMock.mockImplementation(() => makeSpawnResult('', 1))
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
