import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath } from './executor.js'
import * as fs from 'node:fs/promises'

const fsMock = vi.mocked(fs)

describe('validatePath', () => {
  beforeEach(() => vi.resetAllMocks())

  it('WORKSPACE_ROOT 내부 경로는 통과한다', async () => {
    fsMock.realpath.mockImplementation(async (p) => String(p))
    await expect(validatePath('/workspace/project', '/workspace')).resolves.toBe('/workspace/project')
  })

  it('WORKSPACE_ROOT 외부 경로는 오류를 던진다', async () => {
    fsMock.realpath.mockImplementation(async (p) => String(p))
    await expect(validatePath('/etc/passwd', '/workspace')).rejects.toThrow('경로 거부')
  })

  it('WORKSPACE_ROOT 형제 디렉토리는 오류를 던진다', async () => {
    fsMock.realpath.mockImplementation(async (p) => String(p))
    await expect(validatePath('/workspace-evil/project', '/workspace')).rejects.toThrow('경로 거부')
  })

  it('WORKSPACE_ROOT가 파일시스템 루트이면 오류를 던진다', async () => {
    fsMock.realpath.mockImplementation(async (p) => String(p))
    await expect(validatePath('project', '/')).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
  })
})
