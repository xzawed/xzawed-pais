import { vi, test, expect } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath } from './executor.js'
import * as fsp from 'node:fs/promises'

const realpath = vi.mocked(fsp).realpath

test.each([
  ['/audit-root/target.ts', '/audit-root', true] as const,
  ['/intrusion-attempt/passwd', '/audit-root', false] as const,
  ['/audit-root-shadow/attack', '/audit-root', false] as const,
])('validatePath 감사 경로 보안 검증: %s vs %s', async (filePath, root, allowed) => {
  realpath.mockReset()
  realpath.mockImplementation(async (p) => String(p))
  if (allowed) {
    await expect(validatePath(filePath, root)).resolves.toBe(filePath)
  } else {
    await expect(validatePath(filePath, root)).rejects.toThrow('경로 거부')
  }
})

test('validatePath: 파일시스템 루트 WORKSPACE_ROOT는 거부된다', async () => {
  realpath.mockReset()
  realpath.mockImplementation(async (p) => String(p))
  await expect(validatePath('audit-target', '/')).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
})
