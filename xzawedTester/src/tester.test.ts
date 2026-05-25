import { vi, describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('./executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
  exec: vi.fn(),
}))

vi.mock('./detector.js', () => ({
  detectTestCommand: vi.fn().mockResolvedValue('vitest run'),
  buildCommandWithFiles: vi.fn().mockImplementation((cmd: string, files: string[]) =>
    files.length ? `${cmd} ${files.join(' ')}` : cmd
  ),
  parseTestCounts: vi.fn().mockReturnValue({ passed: 10, failed: 0 }),
}))

import { validatePath, exec } from './executor.js'
import { detectTestCommand, buildCommandWithFiles, parseTestCounts } from './detector.js'
import { Tester } from './tester.js'
import type { ManagerToTesterMessage } from './types.js'

const mockValidatePath = vi.mocked(validatePath)
const mockExec = vi.mocked(exec)
const mockDetect = vi.mocked(detectTestCommand)
const mockBuildCmd = vi.mocked(buildCommandWithFiles)
const mockParse = vi.mocked(parseTestCounts)

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockAnalyzeFailures = vi.fn().mockResolvedValue([])

const config = {
  anthropicApiKey: 'sk-test',
  claudeModel: 'test',
  redisUrl: 'redis://localhost:6379',
  port: 3005,
  mode: 'local' as const,
  workspaceRoot: '/workspace',
  testTimeoutMs: 60_000,
}

function makeRequest(overrides?: Partial<ManagerToTesterMessage['payload']>): ManagerToTesterMessage {
  return {
    sessionId: 'sess-1', messageId: 'msg-1', timestamp: Date.now(),
    type: 'test_request',
    payload: { projectPath: '/workspace/app', context: {}, ...overrides },
  }
}

let tester: Tester

beforeEach(() => {
  vi.resetAllMocks()
  mockValidatePath.mockImplementation((p: string) => Promise.resolve(p))
  mockExec.mockResolvedValue({ success: true, output: '10 passed', exitCode: 0, duration: 500 })
  mockDetect.mockResolvedValue('vitest run')
  mockBuildCmd.mockImplementation((cmd: string, files: string[]) =>
    files.length ? `${cmd} ${files.join(' ')}` : cmd
  )
  mockParse.mockReturnValue({ passed: 10, failed: 0 })
  mockPublish.mockResolvedValue(undefined)
  mockAnalyzeFailures.mockResolvedValue([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tester = new Tester({ publish: mockPublish } as any, { analyzeFailures: mockAnalyzeFailures } as any, config)
})

describe('Tester.handle', () => {
  it('publishes test_complete on success', async () => {
    await tester.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'test_complete',
      payload: expect.objectContaining({ success: true }),
    }))
  })

  it('returns immediately on abort', async () => {
    const abort: ManagerToTesterMessage = {
      sessionId: 'sess-1', messageId: 'msg-2', timestamp: Date.now(),
      type: 'abort', payload: { projectPath: '', context: {} },
    }
    await tester.handle(abort)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('uses provided testCommand instead of detecting', async () => {
    await tester.handle(makeRequest({ testCommand: 'npm test' }))
    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockExec).toHaveBeenCalledWith('npm test', expect.any(String), expect.any(Function), config.testTimeoutMs)
  })

  it('calls analyzeFailures when tests fail', async () => {
    mockExec.mockResolvedValueOnce({ success: false, output: '3 failed', exitCode: 1, duration: 300 })
    mockParse.mockReturnValueOnce({ passed: 0, failed: 3 })
    await tester.handle(makeRequest())
    expect(mockAnalyzeFailures).toHaveBeenCalled()
  })

  it('does not call analyzeFailures when tests pass', async () => {
    await tester.handle(makeRequest())
    expect(mockAnalyzeFailures).not.toHaveBeenCalled()
  })

  it('publishes error when validatePath throws', async () => {
    mockValidatePath.mockRejectedValueOnce(new Error('경로 거부: /etc'))
    await tester.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: '경로 거부: /etc' }),
    }))
  })

  it('publishes error when testCommand has disallowed prefix', async () => {
    await tester.handle(makeRequest({ testCommand: 'rm -rf /' }))
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: expect.stringContaining('testCommand not allowed') }),
    }))
  })

  it('publishes error when testCommand contains shell metacharacters', async () => {
    await tester.handle(makeRequest({ testCommand: 'pnpm test; rm -rf /' }))
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: expect.stringContaining('Shell metacharacters') }),
    }))
  })

  it('validates each testFile and passes resolved paths to buildCommandWithFiles', async () => {
    const files = ['src/foo.test.ts', 'src/bar.test.ts']
    await tester.handle(makeRequest({ testFiles: files }))
    const expectedPaths = files.map((f) => path.resolve(config.workspaceRoot, f))
    expect(mockBuildCmd).toHaveBeenCalledWith('vitest run', expectedPaths)
  })
})
