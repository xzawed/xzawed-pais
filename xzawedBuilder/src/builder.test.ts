import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./detector.js')
vi.mock('./executor.js')

import { Builder } from './builder.js'
import * as detector from './detector.js'
import * as executor from './executor.js'
import type { ManagerToBuilderMessage } from './types.js'

const detectorMock = vi.mocked(detector)
const executorMock = vi.mocked(executor)

const mockConfig = {
  workspaceRoot: '/workspace',
  buildTimeoutMs: 5000,
  anthropicApiKey: 'sk-test',
  claudeModel: 'claude-sonnet-4-6',
  redisUrl: 'redis://localhost:6379',
  port: 3006,
  mode: 'local' as const,
}

const buildRequest = (override?: Partial<ManagerToBuilderMessage['payload']>): ManagerToBuilderMessage => ({
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'build_request',
  payload: { projectPath: '/workspace/project', target: 'production', context: {}, ...override },
})

describe('Builder', () => {
  let producer: { publish: ReturnType<typeof vi.fn> }
  let runner: { analyzeBuildFailure: ReturnType<typeof vi.fn> }
  let builder: Builder

  beforeEach(() => {
    vi.resetAllMocks()
    producer = { publish: vi.fn().mockResolvedValue(undefined) }
    runner = { analyzeBuildFailure: vi.fn().mockResolvedValue([]) }
    builder = new Builder(producer as any, runner as any, mockConfig)

    executorMock.validatePath.mockResolvedValue('/workspace/project')
    detectorMock.detectBuildCommand.mockResolvedValue('pnpm build')
    executorMock.exec.mockResolvedValue({ success: true, output: 'Build OK', exitCode: 0, duration: 100 })
  })

  it('성공 빌드 시 build_complete(success:true)를 발행한다', async () => {
    await builder.handle(buildRequest())
    const calls = producer.publish.mock.calls
    const completeCall = calls.find(([, msg]) => msg.type === 'build_complete')
    expect(completeCall).toBeDefined()
    expect(completeCall![1].payload.success).toBe(true)
    expect(completeCall![1].payload.errors).toHaveLength(0)
  })

  it('실패 빌드 시 Claude를 호출하고 build_complete(success:false)를 발행한다', async () => {
    executorMock.exec.mockResolvedValue({ success: false, output: 'Error: ...', exitCode: 1, duration: 200 })
    runner.analyzeBuildFailure.mockResolvedValue([{ message: 'Type error', suggestion: '타입 확인' }])

    await builder.handle(buildRequest())
    expect(runner.analyzeBuildFailure).toHaveBeenCalledWith('Error: ...')
    const calls = producer.publish.mock.calls
    const completeCall = calls.find(([, msg]) => msg.type === 'build_complete')
    expect(completeCall![1].payload.success).toBe(false)
    expect(completeCall![1].payload.errors).toHaveLength(1)
  })

  it('커스텀 command가 있으면 detector를 호출하지 않는다', async () => {
    await builder.handle(buildRequest({ command: 'make build' }))
    expect(detectorMock.detectBuildCommand).not.toHaveBeenCalled()
    expect(executorMock.exec).toHaveBeenCalledWith('make build', expect.any(String), expect.any(Function), 5000)
  })

  it('경로 검증 실패 시 error 메시지를 발행한다', async () => {
    executorMock.validatePath.mockRejectedValue(new Error('경로 거부: /etc/passwd'))
    await builder.handle(buildRequest({ projectPath: '/etc/passwd' }))
    const calls = producer.publish.mock.calls
    const errorCall = calls.find(([, msg]) => msg.type === 'error')
    expect(errorCall).toBeDefined()
    expect(errorCall![1].payload.content).toContain('경로 거부')
  })

  it('abort 메시지는 무시한다', async () => {
    const abortMsg: ManagerToBuilderMessage = {
      ...buildRequest(),
      type: 'abort',
    }
    await builder.handle(abortMsg)
    expect(producer.publish).not.toHaveBeenCalled()
  })
})
