import { vi, test, expect } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath } from './executor.js'
import * as fsp from 'node:fs/promises'

const mockRealpath = vi.mocked(fsp.realpath)

test('validatePath: 테스트 워크스페이스 내부 경로를 허용한다', async () => {
  mockRealpath.mockImplementation(async (p) => String(p))
  const allowed: Array<[string, string]> = [
    ['/test-workspace/suite.test.ts', '/test-workspace'],
    ['/test-workspace/unit/helper.ts', '/test-workspace'],
  ]
  for (const [p, root] of allowed) {
    await expect(validatePath(p, root)).resolves.toBe(p)
  }
})

test('validatePath: 외부 경로와 형제 디렉토리를 거부한다', async () => {
  mockRealpath.mockReset()
  mockRealpath.mockImplementation(async (p) => String(p))
  const blocked: Array<[string, string]> = [
    ['/etc/passwd', '/test-workspace'],
    ['/test-workspace-fork/helper.ts', '/test-workspace'],
  ]
  for (const [p, root] of blocked) {
    await expect(validatePath(p, root)).rejects.toThrow('경로 거부')
  }
})

test('validatePath: 루트 워크스페이스는 거부한다', async () => {
  mockRealpath.mockReset()
  mockRealpath.mockImplementation(async (p) => String(p))
  await expect(validatePath('suite.test.ts', '/')).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
})

test('validatePath: 존재하지 않는 경로는 거부한다 (TOCTOU 방지)', async () => {
  mockRealpath.mockReset()
  // First call (targetPath) rejects — simulates non-existent path
  mockRealpath.mockRejectedValueOnce(new Error('ENOENT'))
  // Second call (workspaceRoot) would succeed, but we never reach it
  mockRealpath.mockImplementation(async (p) => String(p))
  await expect(validatePath('/test-workspace/ghost.ts', '/test-workspace')).rejects.toThrow('경로 거부')
})
