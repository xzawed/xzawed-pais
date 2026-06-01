import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Producer } from '../streams/producer.js'
import type { ClaudeRunner } from '../claude/runner.js'
import type { Config } from '../config.js'

vi.mock('../executor.js', () => ({
  exec: vi.fn(),
  validatePath: vi.fn(),
}))

vi.mock('../detector.js', () => ({
  detectBuildInfo: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdtemp: vi.fn(),
    rm: vi.fn(),
  },
}))

vi.mock('@xzawed/agent-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xzawed/agent-streams')>()),
  resolveWorkspaceRoot: vi.fn((_ctx: unknown, fallback: string) => fallback),
  validateWorkspaceRoot: vi.fn(),
}))

const WORKSPACE = '/workspace'

function makeProducer() {
  const publish = vi.fn().mockResolvedValue(undefined)
  return { publish } as unknown as Producer
}

function makeRunner() {
  return { analyzeBuildFailure: vi.fn().mockResolvedValue([]) } as unknown as ClaudeRunner
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: 'test',
    claudeModel: 'claude-test',
    redisUrl: 'redis://localhost:6379',
    port: 3006,
    mode: 'local',
    workspaceRoot: WORKSPACE,
    buildTimeoutMs: 120000,
    ...overrides,
  }
}

function makeMessage(command?: string) {
  return {
    sessionId: 'sess-build-1',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'build_request' as const,
    payload: {
      projectPath: '/workspace/myapp',
      target: 'production' as const,
      context: {},
      ...(command !== undefined ? { command } : {}),
    },
  }
}

describe('Builder.handle — artifacts 필드', () => {
  let mockExec: ReturnType<typeof vi.fn>
  let mockValidatePath: ReturnType<typeof vi.fn>
  let mockDetectBuildInfo: ReturnType<typeof vi.fn>
  let fs: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    vi.clearAllMocks()

    const executorMod = await import('../executor.js') as Record<string, unknown>
    mockExec = executorMod.exec as ReturnType<typeof vi.fn>
    mockValidatePath = executorMod.validatePath as ReturnType<typeof vi.fn>

    const detectorMod = await import('../detector.js') as Record<string, unknown>
    mockDetectBuildInfo = detectorMod.detectBuildInfo as ReturnType<typeof vi.fn>

    const fsMod = await import('node:fs/promises')
    fs = fsMod.default as unknown as Record<string, ReturnType<typeof vi.fn>>

    mockValidatePath.mockImplementation(async (p: string) => p)
    fs.access = vi.fn().mockRejectedValue(new Error('not found'))
    fs.readFile = vi.fn().mockRejectedValue(new Error('no package.json'))
    fs.mkdtemp = vi.fn().mockResolvedValue('/tmp/xzawed-builder-xxx')
    fs.writeFile = vi.fn().mockResolvedValue(undefined)
    fs.rename = vi.fn().mockResolvedValue(undefined)
    fs.rm = vi.fn().mockResolvedValue(undefined)

    mockDetectBuildInfo.mockResolvedValue({
      command: 'pnpm build',
      buildRoot: '/workspace/myapp',
    })
  })

  it('빌드 성공 시 build_complete 메시지에 artifacts 배열이 buildRoot를 포함한다', async () => {
    mockExec.mockResolvedValue({
      success: true,
      output: 'Build successful',
      exitCode: 0,
      duration: 1000,
    })

    const producer = makeProducer()
    const runner = makeRunner()
    const { Builder } = await import('../builder.js')
    const builder = new Builder(producer, runner, makeConfig())

    await builder.handle(makeMessage('pnpm build'))

    const publishFn = producer.publish as ReturnType<typeof vi.fn>
    expect(publishFn).toHaveBeenCalledOnce()

    const [, msg] = publishFn.mock.calls[0] as [string, {
      type: string
      payload: { success: boolean; artifacts: string[] }
    }]

    expect(msg.type).toBe('build_complete')
    expect(msg.payload.success).toBe(true)
    expect(Array.isArray(msg.payload.artifacts)).toBe(true)
    expect(msg.payload.artifacts.length).toBeGreaterThan(0)
    expect(msg.payload.artifacts[0]).toBe('/workspace/myapp')
  })

  it('빌드 실패 시 build_complete 메시지의 artifacts가 빈 배열이다', async () => {
    mockExec.mockResolvedValue({
      success: false,
      output: 'Build failed: syntax error',
      exitCode: 1,
      duration: 500,
    })

    const producer = makeProducer()
    const runner = makeRunner()
    const { Builder } = await import('../builder.js')
    const builder = new Builder(producer, runner, makeConfig())

    await builder.handle(makeMessage('pnpm build'))

    const publishFn = producer.publish as ReturnType<typeof vi.fn>
    expect(publishFn).toHaveBeenCalledOnce()

    const [, msg] = publishFn.mock.calls[0] as [string, {
      type: string
      payload: { success: boolean; artifacts: string[] }
    }]

    expect(msg.type).toBe('build_complete')
    expect(msg.payload.success).toBe(false)
    expect(Array.isArray(msg.payload.artifacts)).toBe(true)
    expect(msg.payload.artifacts).toHaveLength(0)
  })

  it('validatePath 실패 시 error 메시지를 발행한다', async () => {
    mockValidatePath.mockRejectedValue(new Error('경로 거부: /workspace/evil'))

    const producer = makeProducer()
    const runner = makeRunner()
    const { Builder } = await import('../builder.js')
    const builder = new Builder(producer, runner, makeConfig())

    await builder.handle(makeMessage('pnpm build'))

    const publishFn = producer.publish as ReturnType<typeof vi.fn>
    const [, msg] = publishFn.mock.calls[0] as [string, { type: string; payload: { content: string } }]

    expect(msg.type).toBe('error')
    expect(msg.payload.content).toContain('경로 거부')
  })
})
