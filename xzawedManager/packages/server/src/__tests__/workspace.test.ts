import { describe, it, expect, vi } from 'vitest'
import { ensureWorkspace } from '../workspace.js'
import fs from 'node:fs/promises'

vi.mock('node:fs/promises', () => ({
  default: { mkdir: vi.fn().mockResolvedValue(undefined) },
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

const BASE_CTX = { userId: 'u1', projectId: 'p1' }

describe('ensureWorkspace — validateWorkspaceRoot', () => {
  it('빈 문자열이면 Error throw', async () => {
    await expect(
      ensureWorkspace({ ...BASE_CTX, workspaceRoot: '' }),
    ).rejects.toThrow('WORKSPACE_ROOT must not be empty')
  })

  it('공백만 있으면 Error throw', async () => {
    await expect(
      ensureWorkspace({ ...BASE_CTX, workspaceRoot: '   ' }),
    ).rejects.toThrow('WORKSPACE_ROOT must not be empty')
  })

  it('파일시스템 루트이면 Error throw', async () => {
    const { parse } = await import('node:path')
    const fsRoot = parse(process.cwd()).root
    await expect(
      ensureWorkspace({ ...BASE_CTX, workspaceRoot: fsRoot }),
    ).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
  })

  it('유효한 workspaceRoot — mkdir 호출', async () => {
    vi.mocked(fs.mkdir).mockClear()
    await expect(
      ensureWorkspace({ ...BASE_CTX, workspaceRoot: '/home/user/workspace' }),
    ).resolves.toBeUndefined()
    expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith('/home/user/workspace', { recursive: true })
  })
})
