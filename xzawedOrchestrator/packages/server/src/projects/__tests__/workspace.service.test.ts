import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSpawn, mockAccess } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockAccess: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: mockSpawn }))
vi.mock('node:fs/promises', () => ({ access: mockAccess, constants: { R_OK: 4 } }))

import { WorkspaceService } from '../workspace.service.js'

describe('WorkspaceService', () => {
  let svc: WorkspaceService

  beforeEach(() => {
    svc = new WorkspaceService()
    mockSpawn.mockReset()
    mockAccess.mockReset()
  })

  it('validateLocalPath resolves when path is accessible', async () => {
    mockAccess.mockResolvedValue(undefined)
    await expect(svc.validateLocalPath('/home/user/app')).resolves.toBeUndefined()
    expect(mockAccess).toHaveBeenCalledWith('/home/user/app', 4)
  })

  it('validateLocalPath throws when path is not accessible', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    await expect(svc.validateLocalPath('/nonexistent')).rejects.toThrow('로컬 경로에 접근할 수 없습니다')
  })

  it('clonePath returns correct path under homedir', () => {
    const path = svc.clonePath('proj-123')
    expect(path).toContain('proj-123')
    expect(path).toContain('.xzawed')
    expect(path).toContain('workspaces')
  })

  it('cloneRepo spawns git clone with shell:false', async () => {
    const mockProc = {
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => { if (event === 'close') cb(0) }),
    }
    mockSpawn.mockReturnValue(mockProc)

    await svc.cloneRepo('https://github.com/user/repo', '/tmp/dest', 'main')

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['clone', '--branch', 'main', '--depth', '1', 'https://github.com/user/repo', '/tmp/dest'],
      expect.objectContaining({ shell: false }),
    )
  })

  it('pullRepo spawns git pull with shell:false', async () => {
    const mockProc = {
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => { if (event === 'close') cb(0) }),
    }
    mockSpawn.mockReturnValue(mockProc)

    await svc.pullRepo('/home/user/project', 'main')

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['pull', 'origin', 'main'],
      expect.objectContaining({ shell: false, cwd: '/home/user/project' }),
    )
  })

  it('rejects when git exits with non-zero code', async () => {
    const mockProc = {
      stderr: { on: vi.fn((e, cb) => { if (e === 'data') cb(Buffer.from('fatal error')) }) },
      on: vi.fn((event, cb) => { if (event === 'close') cb(1) }),
    }
    mockSpawn.mockReturnValue(mockProc)

    await expect(svc.cloneRepo('https://github.com/user/repo', '/tmp/dest', 'main')).rejects.toThrow('git clone failed')
  })
})
