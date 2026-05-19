import { vi, describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process')
vi.mock('node:fs/promises')

import { exec, validatePath } from './executor.js'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'

const spawnMock = vi.mocked(spawn)
const fsMock = vi.mocked(fs)

function makeMockProc(exitCode: number, stdout = '', stderr = '') {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
    proc.emit('close', exitCode)
  })
  return proc
}

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

describe('exec', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exitCode 0이면 success: true를 반환한다', async () => {
    spawnMock.mockReturnValueOnce(makeMockProc(0, 'Test passed\n') as any)
    const chunks: string[] = []
    const result = await exec('vitest run', '/project', (c) => { chunks.push(c) }, 5000)
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Test passed')
    expect(chunks).toHaveLength(1)
  })

  it('exitCode 1이면 success: false를 반환한다', async () => {
    spawnMock.mockReturnValueOnce(makeMockProc(1, '', 'Error: assertion failed\n') as any)
    const result = await exec('vitest run', '/project', () => {}, 5000)
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Error: assertion failed')
  })

  it('타임아웃 초과 시 reject한다', async () => {
    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    spawnMock.mockReturnValueOnce(proc as any)

    await expect(exec('sleep 100', '/project', () => {}, 50)).rejects.toThrow('테스트 타임아웃')
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
