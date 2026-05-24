import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  default: { mkdir: vi.fn().mockResolvedValue(undefined) },
}))

import fs from 'node:fs/promises'
import { ensureWorkspace } from '../src/workspace.js'

describe('ensureWorkspace', () => {
  afterEach(() => vi.clearAllMocks())

  it('workspaceRoot 디렉토리를 재귀 생성한다', async () => {
    await ensureWorkspace({ userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/project' })
    expect(fs.mkdir).toHaveBeenCalledWith('/workspace/project', { recursive: true })
  })

  it('다른 workspaceRoot에 대해서도 정확히 호출한다', async () => {
    await ensureWorkspace({ userId: 'u2', projectId: 'p2', workspaceRoot: '/tmp/other' })
    expect(fs.mkdir).toHaveBeenCalledWith('/tmp/other', { recursive: true })
  })
})
