import { vi, describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process')
vi.mock('node:fs/promises')
vi.mock('@xzawed/agent-streams', () => ({ validateWorkspaceRoot: vi.fn() }))

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

  it('존재하지 않는 경로(realpath 실패)는 path.resolve 폴백 없이 오류를 던진다', async () => {
    // projectPath realpath fails → must throw, not silently resolve
    fsMock.realpath.mockImplementation(async (p) => {
      if (String(p).includes('nonexistent')) throw new Error('ENOENT')
      return String(p)
    })
    await expect(validatePath('/workspace/nonexistent', '/workspace')).rejects.toThrow('경로 거부')
  })
})

describe('exec', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exitCode 0이면 success: true를 반환한다', async () => {
    spawnMock.mockReturnValueOnce(makeMockProc(0, 'Build succeeded\n') as any)
    const chunks: string[] = []
    const result = await exec('pnpm build', '/project', (c) => { chunks.push(c) }, 5000)
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Build succeeded')
    expect(chunks).toHaveLength(1)
  })

  it('exitCode 1이면 success: false를 반환한다', async () => {
    spawnMock.mockReturnValueOnce(makeMockProc(1, '', 'Error: type mismatch\n') as any)
    const result = await exec('pnpm build', '/project', () => {}, 5000)
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Error: type mismatch')
  })

  it('타임아웃 초과 시 reject하고 SIGTERM을 보낸다', async () => {
    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    // 절대 close 이벤트를 발행하지 않는 프로세스
    spawnMock.mockReturnValueOnce(proc as any)

    await expect(exec('sleep 100', '/project', () => {}, 50)).rejects.toThrow('빌드 타임아웃')
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('타임아웃 후 프로세스가 종료되면 SIGKILL 타이머를 취소한다', async () => {
    vi.useFakeTimers()
    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    spawnMock.mockReturnValueOnce(proc as any)

    const promise = exec('sleep 100', '/project', () => {}, 100)
    vi.advanceTimersByTime(100) // trigger timeout → SIGTERM
    proc.emit('close', 0) // process exits after SIGTERM
    await expect(promise).rejects.toThrow('빌드 타임아웃')
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })

  it('빈 명령어는 Promise 외부에서 즉시 오류를 던진다', async () => {
    await expect(exec('', '/project', () => {}, 5000)).rejects.toThrow('Empty command')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('출력이 최대 크기를 초과하면 잘린다', async () => {
    const bigChunk = 'x'.repeat(11 * 1024 * 1024) // 11 MiB > 10 MiB limit
    spawnMock.mockReturnValueOnce(makeMockProc(0, bigChunk) as any)
    const result = await exec('pnpm build', '/project', () => {}, 5000)
    expect(result.output).toContain('잘렸습니다')
    expect(Buffer.byteLength(result.output)).toBeLessThan(12 * 1024 * 1024)
  })
})
