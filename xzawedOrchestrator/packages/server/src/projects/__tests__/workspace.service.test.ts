import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSpawn, mockRm } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockRm: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: mockSpawn }))
vi.mock('node:fs/promises', () => ({ rm: mockRm }))

import { WorkspaceService } from '../workspace.service.js'
import { validateBranchName } from '../branch-validation.js'

describe('WorkspaceService', () => {
  let svc: WorkspaceService

  beforeEach(() => {
    svc = new WorkspaceService()
    mockSpawn.mockReset()
    mockRm.mockReset()
    mockRm.mockResolvedValue(undefined)
  })

  // `validateLocalPath` 는 이 클래스에서 제거됐다 — 경로 판정의 단일 출처는
  // `workspace-path.ts` 이고 그 계약은 `__tests__/workspace-path.test.ts` 가 갖는다.
  // 여기 두면 라우트 테스트들이 이 클래스를 통째로 mock 하므로 검증기가 무력화된다.

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
      ['clone', '--branch', 'main', '--depth', '1', '--', 'https://github.com/user/repo', '/tmp/dest'],
      expect.objectContaining({ shell: false }),
    )
  })

  it('pullRepo spawns git fetch + reset with shell:false', async () => {
    const mockProc = {
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => { if (event === 'close') cb(0) }),
    }
    mockSpawn.mockReturnValue(mockProc)

    await svc.pullRepo('/home/user/project', 'main')

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', 'main'],
      expect.objectContaining({ shell: false, cwd: '/home/user/project' }),
    )
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      'git',
      ['reset', '--hard', 'origin/main'],
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

  it('clone 실패 시 destPath를 정리한다 (fs.rm 호출 확인)', async () => {
    const mockProc = {
      stderr: { on: vi.fn((e, cb) => { if (e === 'data') cb(Buffer.from('fatal: repository not found')) }) },
      on: vi.fn((event, cb) => { if (event === 'close') cb(128) }),
    }
    mockSpawn.mockReturnValue(mockProc)

    await expect(
      svc.cloneRepo('https://github.com/user/nonexistent', '/tmp/clone-dest', 'main')
    ).rejects.toThrow('git clone failed')

    expect(mockRm).toHaveBeenCalledWith('/tmp/clone-dest', { recursive: true, force: true })
  })

  it('clone 실패 시 fs.rm 자체가 실패해도 원래 에러를 throw한다', async () => {
    const mockProc = {
      stderr: { on: vi.fn((e, cb) => { if (e === 'data') cb(Buffer.from('fatal: auth failed')) }) },
      on: vi.fn((event, cb) => { if (event === 'close') cb(128) }),
    }
    mockSpawn.mockReturnValue(mockProc)
    mockRm.mockRejectedValue(new Error('EPERM: permission denied'))

    await expect(
      svc.cloneRepo('https://github.com/user/repo', '/tmp/clone-dest', 'main')
    ).rejects.toThrow('git clone failed')
  })

  it('cloneRepo rejects invalid branch name before spawning', async () => {
    await expect(svc.cloneRepo('https://github.com/user/repo', '/workspaces/dest', '-bad-branch')).rejects.toThrow('Invalid branch name')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('pullRepo rejects invalid branch name before spawning', async () => {
    await expect(svc.pullRepo('/workspaces/project', 'bad;branch')).rejects.toThrow('Invalid branch name')
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})

describe('validateBranchName', () => {
  it.each(['main', 'develop', 'feature/my-feat', 'release-1.0', 'v2.0.0', 'fix_issue'])('유효한 브랜치 이름 허용: %s', (name) => {
    expect(() => validateBranchName(name)).not.toThrow()
  })

  it.each(['-bad', '.bad', '', 'bad;branch', 'bad branch', 'bad|branch', 'bad&branch', '../etc'])('유효하지 않은 브랜치 이름 거부: %s', (name) => {
    expect(() => validateBranchName(name)).toThrow('Invalid branch name')
  })
})
