import { vi, it, expect } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath } from './executor.js'
import * as fs from 'node:fs/promises'

it('watcher validatePath: WORKSPACE_ROOT 내부 감시 경로를 허용한다', async () => {
  vi.mocked(fs).realpath.mockImplementation(async (p) => String(p))
  const result = await validatePath('/watch-workspace/watched-dir/file.ts', '/watch-workspace')
  expect(result).toBe('/watch-workspace/watched-dir/file.ts')
})

it('watcher validatePath: 존재하지 않는 경로는 거부한다 (TOCTOU 방지)', async () => {
  vi.mocked(fs).realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  await expect(validatePath('/watch-workspace/nonexistent', '/watch-workspace')).rejects.toThrow('ENOENT')
})
