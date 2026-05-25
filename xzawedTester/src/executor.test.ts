import { vi, test, expect } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath, exec } from './executor.js'
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

test('exec: 빈 명령어는 즉시 Error throw', async () => {
  await expect(exec('', '/tmp', () => {}, 1000)).rejects.toThrow('Invalid command')
})

vi.mock('node:child_process', () => {
  const mockProc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
    pid: 12345,
  }
  return {
    spawn: vi.fn(() => mockProc),
    __mockProc: mockProc,
  }
})

import * as childProcess from 'node:child_process'

function getMockProc() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (childProcess as any).__mockProc as {
    stdout: { on: ReturnType<typeof vi.fn> }
    stderr: { on: ReturnType<typeof vi.fn> }
    on: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
    killed: boolean
  }
}

test('exec: 5초 후에도 프로세스가 살아있으면 SIGKILL로 강제 종료한다', async () => {
  vi.useFakeTimers()

  const mockProc = getMockProc()
  mockProc.kill.mockClear()
  mockProc.killed = false

  const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  mockProc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    eventHandlers[`stdout:${event}`] = [...(eventHandlers[`stdout:${event}`] ?? []), cb]
  })
  mockProc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    eventHandlers[`stderr:${event}`] = [...(eventHandlers[`stderr:${event}`] ?? []), cb]
  })
  mockProc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    eventHandlers[event] = [...(eventHandlers[event] ?? []), cb]
  })

  const execPromise = exec('node test.js', '/workspace', () => {}, 100)
  // Suppress unhandled rejection
  execPromise.catch(() => {})

  // Trigger SIGTERM timeout
  await vi.advanceTimersByTimeAsync(100)
  expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

  // Process has NOT exited (killed = false) — advance past 5s SIGKILL window
  await vi.advanceTimersByTimeAsync(5000)

  // SIGKILL must have been called since proc.killed is still false
  expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL')

  vi.useRealTimers()
})

test('exec: SIGTERM으로 프로세스 종료 시 SIGKILL 타이머가 정리된다', async () => {
  vi.useFakeTimers()

  const mockProc = getMockProc()
  mockProc.kill.mockClear()
  mockProc.killed = false

  // stdout/stderr/close 이벤트 핸들러 등록 캡처
  const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  mockProc.stdout.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    eventHandlers[`stdout:${event}`] = [...(eventHandlers[`stdout:${event}`] ?? []), cb]
  })
  mockProc.stderr.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    eventHandlers[`stderr:${event}`] = [...(eventHandlers[`stderr:${event}`] ?? []), cb]
  })
  mockProc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    eventHandlers[event] = [...(eventHandlers[event] ?? []), cb]
  })

  // rejection을 미리 처리해 두어 unhandled rejection 방지
  const execPromise = exec('node test.js', '/workspace', () => {}, 100)
  const handledPromise = execPromise.catch(() => {})

  // 타임아웃 트리거 (100ms)
  await vi.advanceTimersByTimeAsync(100)

  // SIGTERM 이후 프로세스가 정상 종료됐다고 가정 — close 이벤트 발생
  mockProc.killed = true
  const closeHandlers = eventHandlers['close'] ?? []
  for (const handler of closeHandlers) handler(0)

  // execPromise 완료 대기
  await handledPromise

  // close 이벤트 직후 SIGKILL 호출 횟수 기록
  const killCallsBefore = mockProc.kill.mock.calls.length

  // 5초 이상 경과 후에도 SIGKILL이 추가로 호출되지 않아야 한다
  await vi.advanceTimersByTimeAsync(6000)
  const killCallsAfter = mockProc.kill.mock.calls.length

  expect(killCallsAfter).toBe(killCallsBefore)

  vi.useRealTimers()
})
