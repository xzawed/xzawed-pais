import { vi, it, expect } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath } from './executor.js'
import * as fs from 'node:fs/promises'

it('security validatePath: WORKSPACE_ROOT 내부 감사 대상 경로를 허용한다', async () => {
  vi.mocked(fs).realpath.mockImplementation(async (p) => String(p))
  const result = await validatePath('/audit-workspace/src/auth.ts', '/audit-workspace')
  expect(result).toBe('/audit-workspace/src/auth.ts')
})
