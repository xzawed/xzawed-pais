import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./detector.js')
vi.mock('./executor.js')
vi.mock('node:fs/promises')

import { Builder } from './builder.js'
import * as detector from './detector.js'
import * as executor from './executor.js'
import * as fs from 'node:fs/promises'
import type { ManagerToBuilderMessage } from './types.js'

const detectorMock = vi.mocked(detector)
const executorMock = vi.mocked(executor)
const fsMock = vi.mocked(fs)

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
  let runner: { analyzeBuildFailure: ReturnType<typeof vi.fn>; extractKnowledge: ReturnType<typeof vi.fn> }
  let builder: Builder

  beforeEach(() => {
    vi.resetAllMocks()
    producer = { publish: vi.fn().mockResolvedValue(undefined) }
    runner = {
      analyzeBuildFailure: vi.fn().mockResolvedValue([]),
      extractKnowledge: vi.fn().mockResolvedValue([]),
    }
    builder = new Builder(producer as any, runner as any, mockConfig)

    executorMock.validatePath.mockResolvedValue('/workspace/project')
    detectorMock.detectBuildInfo.mockResolvedValue({ command: 'pnpm build', buildRoot: '/workspace/project' })
    executorMock.exec.mockResolvedValue({ success: true, output: 'Build OK', exitCode: 0, duration: 100 })
    // Default: no package.json → skip pre-install
    fsMock.access.mockRejectedValue(new Error('ENOENT'))
  })

  const getMsg = (type: string) =>
    producer.publish.mock.calls.find(([, msg]) => msg.type === type)?.[1]

  const expectError = (substring: string) => {
    const msg = getMsg('error')
    expect(msg).toBeDefined()
    expect(msg!.payload.content).toContain(substring)
  }

  const getCompleteMsg = () => getMsg('build_complete')

  it('성공 빌드 시 build_complete(success:true)를 발행한다', async () => {
    await builder.handle(buildRequest())
    const completeMsg = getCompleteMsg()
    expect(completeMsg).toBeDefined()
    expect(completeMsg!.payload.success).toBe(true)
    expect(completeMsg!.payload.errors).toHaveLength(0)
  })

  it('durable 지식이 있으면 build_complete payload에 knowledge를 포함한다', async () => {
    runner.extractKnowledge.mockResolvedValue(['빌드는 Turborepo로 오케스트레이션'])
    await builder.handle(buildRequest())
    expect(runner.extractKnowledge).toHaveBeenCalledWith('Build OK')
    const completeMsg = getCompleteMsg()
    expect(completeMsg!.payload.knowledge).toEqual(['빌드는 Turborepo로 오케스트레이션'])
  })

  it('durable 지식이 없으면 knowledge 키를 생략한다', async () => {
    runner.extractKnowledge.mockResolvedValue([])
    await builder.handle(buildRequest())
    const completeMsg = getCompleteMsg()
    expect(completeMsg!.payload).not.toHaveProperty('knowledge')
  })

  it('실패 빌드 시 Claude를 호출하고 build_complete(success:false)를 발행한다', async () => {
    executorMock.exec.mockResolvedValue({ success: false, output: 'Error: ...', exitCode: 1, duration: 200 })
    runner.analyzeBuildFailure.mockResolvedValue([{ message: 'Type error', suggestion: '타입 확인' }])

    await builder.handle(buildRequest())
    expect(runner.analyzeBuildFailure).toHaveBeenCalledWith('Error: ...')
    const completeMsg = getCompleteMsg()
    expect(completeMsg!.payload.success).toBe(false)
    expect(completeMsg!.payload.errors).toHaveLength(1)
  })

  it('커스텀 command가 있으면 detectBuildInfo를 호출하지 않는다', async () => {
    await builder.handle(buildRequest({ command: 'make build' }))
    expect(detectorMock.detectBuildInfo).not.toHaveBeenCalled()
    expect(executorMock.exec).toHaveBeenCalledWith('make build', expect.any(String), expect.any(Function), 5000)
  })

  it('경로 검증 실패 시 error 메시지를 발행한다', async () => {
    executorMock.validatePath.mockRejectedValue(new Error('경로 거부: /etc/passwd'))
    await builder.handle(buildRequest({ projectPath: '/etc/passwd' }))
    expectError('경로 거부')
  })

  it('abort 메시지는 무시한다', async () => {
    const abortMsg: ManagerToBuilderMessage = {
      ...buildRequest(),
      type: 'abort',
    }
    await builder.handle(abortMsg)
    expect(producer.publish).not.toHaveBeenCalled()
  })

  it('허용되지 않은 커스텀 command는 error 메시지를 발행한다', async () => {
    await builder.handle(buildRequest({ command: 'rm -rf /' }))
    expectError('Build command not allowed')
  })

  it('make 단독 prefix는 허용되지 않는다 (make build만 허용)', async () => {
    await builder.handle(buildRequest({ command: 'make evil-target' }))
    expectError('Build command not allowed')
  })

  it('shell 메타문자가 포함된 command는 error 메시지를 발행한다', async () => {
    await builder.handle(buildRequest({ command: 'pnpm build; rm -rf /' }))
    expectError('Shell metacharacters')
  })

  it('allowlist 프리픽스로 시작해도 내부 개행 뒤 임의 명령은 거부한다 (defense-in-depth)', async () => {
    await builder.handle(buildRequest({ command: 'npm run build\nrm -rf /' }))
    expectError('Shell metacharacters')
  })

  it('prefix 단어 경계 없이 이어지는 command는 거부한다 (e.g. pnpmbuild-arbitrary)', async () => {
    await builder.handle(buildRequest({ command: 'pnpmbuild-arbitrary' }))
    expectError('Build command not allowed')
  })

  it('detectBuildInfo가 반환한 buildRoot에서 exec를 실행한다', async () => {
    detectorMock.detectBuildInfo.mockResolvedValue({ command: 'pnpm run build', buildRoot: '/workspace' })
    // validatePath is called for both projectPath and detected buildRoot — return validated path each time
    executorMock.validatePath
      .mockResolvedValueOnce('/workspace/sub') // for projectPath
      .mockResolvedValueOnce('/workspace')     // for detected.buildRoot
      .mockResolvedValueOnce('/workspace')     // defence-in-depth before runPreInstall
    await builder.handle(buildRequest({ projectPath: '/workspace/sub' }))
    expect(executorMock.exec).toHaveBeenCalledWith('pnpm run build', '/workspace', expect.any(Function), 5000)
  })

  describe('pre-install', () => {
    it('package.json이 있고 node_modules가 없으면 npm install을 먼저 실행한다', async () => {
      fsMock.access.mockImplementation(async (p) => {
        const filePath = String(p)
        if (filePath.endsWith('package.json')) return undefined as any
        throw new Error('ENOENT') // node_modules, pnpm-lock.yaml 없음
      })
      executorMock.exec.mockResolvedValue({ success: true, output: '', exitCode: 0, duration: 50 })

      await builder.handle(buildRequest())

      const execCalls = executorMock.exec.mock.calls
      expect(execCalls[0][0]).toBe('npm ci --ignore-scripts')
      expect(execCalls[1][0]).toBe('pnpm build')
    })

    it('pnpm-lock.yaml이 있으면 pnpm install을 사용한다', async () => {
      fsMock.access.mockImplementation(async (p) => {
        const filePath = String(p)
        if (filePath.endsWith('package.json')) return undefined as any
        if (filePath.endsWith('pnpm-lock.yaml')) return undefined as any
        throw new Error('ENOENT') // node_modules 없음
      })
      executorMock.exec.mockResolvedValue({ success: true, output: '', exitCode: 0, duration: 50 })

      await builder.handle(buildRequest())

      const execCalls = executorMock.exec.mock.calls
      expect(execCalls[0][0]).toBe('pnpm install --frozen-lockfile --ignore-scripts')
    })

    it('node_modules가 이미 있으면 install을 건너뛴다', async () => {
      fsMock.access.mockImplementation(async (p) => {
        const filePath = String(p)
        if (filePath.endsWith('package.json')) return undefined as any
        if (filePath.endsWith('node_modules')) return undefined as any
        throw new Error('ENOENT')
      })
      executorMock.exec.mockResolvedValue({ success: true, output: 'Build OK', exitCode: 0, duration: 100 })

      await builder.handle(buildRequest())

      const execCalls = executorMock.exec.mock.calls
      expect(execCalls).toHaveLength(1)
      expect(execCalls[0][0]).toBe('pnpm build')
    })

    it('package.json이 없으면 install을 건너뛴다', async () => {
      fsMock.access.mockRejectedValue(new Error('ENOENT'))
      await builder.handle(buildRequest())

      const execCalls = executorMock.exec.mock.calls
      expect(execCalls).toHaveLength(1)
      expect(execCalls[0][0]).toBe('pnpm build')
    })

    it('npm install 실패 시 error 메시지를 발행한다', async () => {
      fsMock.access.mockImplementation(async (p) => {
        const filePath = String(p)
        if (filePath.endsWith('package.json')) return undefined as unknown as void
        throw new Error('ENOENT') // node_modules, pnpm-lock.yaml 없음
      })
      executorMock.exec.mockResolvedValueOnce({ success: false, output: 'npm error', exitCode: 1, duration: 100 })

      await builder.handle(buildRequest())

      expectError('의존성 설치 실패')
    })
  })
})
