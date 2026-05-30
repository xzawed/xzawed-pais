import { vi, describe, it, expect, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn()
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create },
    })),
    __create: create,
  }
})

import AnthropicDefault from '@anthropic-ai/sdk'
import { ClaudeRunner, parseMaxIterations } from './runner.js'
import { ToolRegistry } from '../tools/registry.js'

const AnthropicMock = vi.mocked(AnthropicDefault)

function getCreateFn(): ReturnType<typeof vi.fn> {
  // The __create mock is attached to the module-level vi.fn() above
  const mod = vi.mocked(AnthropicDefault) as unknown as { __create: ReturnType<typeof vi.fn> }
  return (AnthropicMock.mock.results[0]?.value as { messages: { create: ReturnType<typeof vi.fn> } })?.messages.create
}

function makeMessage(
  stopReason: string,
  content: Anthropic.ContentBlock[],
): Anthropic.Message {
  return {
    id: 'msg-1',
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: stopReason as Anthropic.Message['stop_reason'],
    stop_sequence: null,
    model: 'claude-test',
    usage: { input_tokens: 10, output_tokens: 10 },
  }
}

function makeTextBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text }
}

function makeToolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input }
}

let registry: ToolRegistry
let mockProducer: { publish: ReturnType<typeof vi.fn> }
let mockSessionStore: { waitForInfo: ReturnType<typeof vi.fn> }
let runner: ClaudeRunner
let createFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()

  registry = new ToolRegistry()
  mockProducer = { publish: vi.fn().mockResolvedValue(undefined) }
  mockSessionStore = { waitForInfo: vi.fn() }

  // Construct a fresh Anthropic mock instance
  const create = vi.fn()
  AnthropicMock.mockImplementation(() => ({
    messages: { create },
  }) as unknown as Anthropic)

  const client = new AnthropicDefault()
  createFn = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create

  runner = new ClaudeRunner(client, 'claude-test', registry)
})

function baseRunOptions(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'sess-1',
    intent: 'Build the app',
    context: {},
    producer: mockProducer as unknown as import('../streams/producer.js').StreamProducer,
    sessionStore: mockSessionStore as unknown as import('../sessions/session.store.js').SessionStore,
    ...overrides,
  }
}

describe('ClaudeRunner', () => {
  describe('end_turn', () => {
    it('end_turn 시 텍스트를 반환한다', async () => {
      createFn.mockResolvedValueOnce(
        makeMessage('end_turn', [makeTextBlock('작업 완료')]),
      )

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('작업 완료')
    })

    it('end_turn 시 텍스트 블록이 없으면 빈 문자열을 반환한다', async () => {
      createFn.mockResolvedValueOnce(makeMessage('end_turn', []))

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('')
    })
  })

  describe('tool_use → end_turn 루프', () => {
    it('툴 한 번 호출 후 end_turn으로 완료한다', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true })
      registry.register({
        name: 'develop_code',
        description: 'Develop code',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: mockExecute,
      })

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [
            makeToolUseBlock('tu-1', 'develop_code', { projectPath: '/workspace' }),
          ]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('완료')
      expect(mockExecute).toHaveBeenCalledOnce()
      expect(createFn).toHaveBeenCalledTimes(2)
    })

    it('tool_use 결과가 messages에 추가된다', async () => {
      registry.register({
        name: 'run_tests',
        description: 'Run tests',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockResolvedValue({ passed: 5, failed: 0 }),
      })

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [
            makeToolUseBlock('tu-2', 'run_tests', {}),
          ]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('테스트 통과')]))

      await runner.run(baseRunOptions())

      // The runner mutates the same messages array in place, so we cannot rely on
      // messages[length-1] after the run completes (it will have grown further).
      // Instead, capture the call count at assertion time and use a fixed index:
      // messages order for 2nd call: [0]=user_initial [1]=assistant_tool_use [2]=user_tool_results
      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      // messages[2] is the tool_result user message at the time of the 2nd create call
      // but since it's the same reference it may have more entries by now — use index 2
      const toolResultMsg = secondCallMessages[2]
      expect(toolResultMsg.role).toBe('user')
      const content = toolResultMsg.content as Anthropic.ToolResultBlockParam[]
      expect(content[0].type).toBe('tool_result')
      expect(content[0].tool_use_id).toBe('tu-2')
    })
  })

  describe('도구 실행 오류 처리', () => {
    it('도구 실행 오류를 is_error: true tool_result로 감싸고 루프를 계속한다', async () => {
      // This test is expected to FAIL before Task 5 fix
      // Current implementation throws when handler throws, instead of wrapping in is_error
      registry.register({
        name: 'build_project',
        description: 'Build project',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockRejectedValue(new Error('빌드 실패')),
      })

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [
            makeToolUseBlock('tu-3', 'build_project', {}),
          ]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('오류 처리 완료')]))

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('오류 처리 완료')

      // The tool_result in the second messages call should have is_error: true
      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const lastMsg = secondCallMessages[secondCallMessages.length - 1]
      const content = lastMsg.content as Array<Anthropic.ToolResultBlockParam & { is_error?: boolean }>
      expect(content[0].is_error).toBe(true)
    })
  })

  describe('MAX_ITERATIONS 초과', () => {
    it('MAX_ITERATIONS 초과 시 에러를 throw한다', async () => {
      // Override MAX_ITERATIONS via env to keep test fast
      const origEnv = process.env['MANAGER_MAX_ITERATIONS']
      process.env['MANAGER_MAX_ITERATIONS'] = '3'

      registry.register({
        name: 'develop_code',
        description: 'Develop code',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockResolvedValue({ ok: true }),
      })

      // Always return tool_use so it loops indefinitely
      createFn.mockResolvedValue(
        makeMessage('tool_use', [
          makeToolUseBlock('tu-loop', 'develop_code', {}),
        ]),
      )

      // Note: MAX_ITERATIONS is read at module load time via const, so env override
      // may not affect this test. We use a large enough mock call count instead.
      // We rely on the runner eventually exhausting whatever MAX_ITERATIONS is set to.
      await expect(runner.run(baseRunOptions())).rejects.toThrow(/exceeded.*iterations/i)

      if (origEnv !== undefined) {
        process.env['MANAGER_MAX_ITERATIONS'] = origEnv
      } else {
        delete process.env['MANAGER_MAX_ITERATIONS']
      }
    }, 30_000)
  })

  describe('AbortSignal', () => {
    it('AbortSignal이 이미 중단된 경우 즉시 에러를 throw한다', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(
        runner.run({ ...baseRunOptions(), signal: controller.signal }),
      ).rejects.toThrow('Session aborted')

      expect(createFn).not.toHaveBeenCalled()
    })
  })

  describe('예상치 못한 stop_reason', () => {
    it('예상치 못한 stop_reason 시 에러를 throw한다', async () => {
      createFn.mockResolvedValueOnce(
        makeMessage('max_tokens', [makeTextBlock('잘렸습니다')]),
      )

      await expect(runner.run(baseRunOptions())).rejects.toThrow(/Unexpected stop_reason/i)
    })
  })

  describe('Claude API 타임아웃', () => {
    it('Claude API 타임아웃 시 에러를 throw한다', async () => {
      // This test is expected to FAIL before Task 5 fix
      // Current implementation does not pass any timeout/signal to client.messages.create
      // After fix, a timeout option should be passed (e.g., via AbortSignal.timeout or signal propagation)
      const controller = new AbortController()
      createFn.mockImplementation(() => {
        // Simulate a timeout / API abort error
        const err = new Error('Request timed out')
        err.name = 'APIConnectionTimeoutError'
        return Promise.reject(err)
      })

      await expect(
        runner.run({ ...baseRunOptions(), signal: controller.signal }),
      ).rejects.toThrow(/timed out/i)

      // Additionally verify that the create call received a signal option
      // signal is passed as the second argument (RequestOptions) to client.messages.create
      expect(createFn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal }),
      )
    })
  })

  describe('알 수 없는 툴', () => {
    it('등록되지 않은 툴 이름이면 is_error: true tool_result로 감싸고 루프를 계속한다', async () => {
      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [
            makeToolUseBlock('tu-x', 'unknown_tool', {}),
          ]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('오류 처리 완료')]))

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('오류 처리 완료')

      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const toolResultMsg = secondCallMessages[secondCallMessages.length - 1]
      const content = toolResultMsg.content as Array<Anthropic.ToolResultBlockParam & { is_error?: boolean }>
      expect(content[0].is_error).toBe(true)
      expect(content[0].content).toContain('Unknown tool: unknown_tool')
    })
  })

  describe('request_info 툴 처리', () => {
    it('request_info 툴 호출 시 info_request를 발행하고 사용자 답변을 반환한다', async () => {
      mockSessionStore.waitForInfo.mockResolvedValueOnce('React')

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [
            makeToolUseBlock('tu-ri', 'request_info', { question: '어떤 프레임워크를 사용할까요?' }),
          ]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('React를 사용하겠습니다')]))

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('React를 사용하겠습니다')

      expect(mockProducer.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info_request' }),
      )
      expect(mockSessionStore.waitForInfo).toHaveBeenCalledWith('sess-1')
    })
  })

  describe('publish 호출', () => {
    it('end_turn 시 producer.publish가 status_update 타입으로 호출된다', async () => {
      createFn.mockResolvedValueOnce(
        makeMessage('end_turn', [makeTextBlock('결과')]),
      )

      await runner.run(baseRunOptions())

      expect(mockProducer.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status_update',
          sessionId: 'sess-1',
          payload: expect.objectContaining({ content: '결과' }),
        }),
      )
    })

    it('툴 실행 전후에 status_update를 publish한다', async () => {
      registry.register({
        name: 'design_ui',
        description: 'Design UI',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockResolvedValue({ spec: 'done' }),
      })

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-4', 'design_ui', {})]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('OK')]))

      await runner.run(baseRunOptions())

      const publishCalls = mockProducer.publish.mock.calls as Array<[{ payload: { content: string } }]>
      const contents = publishCalls.map((c) => c[0].payload.content)
      expect(contents.some((c) => c.includes('Starting design_ui'))).toBe(true)
      expect(contents.some((c) => c.includes('Completed design_ui'))).toBe(true)
    })
  })

  describe('도구 결과 처리', () => {
    it('4000자를 초과하는 도구 결과를 잘라서 반환한다', async () => {
      registry.register({
        name: 'develop_code',
        description: 'Develop code',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockResolvedValue({ data: 'x'.repeat(5000) }),
      })

      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('tu-big', 'develop_code', {})]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run(baseRunOptions())

      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const toolResultMsg = secondCallMessages[2]
      const content = toolResultMsg.content as Anthropic.ToolResultBlockParam[]
      expect(content[0].content as string).toContain('...[truncated]')
    })

    it('도구가 Error 외의 값으로 실패하면 String()으로 변환한다', async () => {
      registry.register({
        name: 'develop_code',
        description: 'Develop code',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockRejectedValue('string error'),
      })

      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('tu-str', 'develop_code', {})]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run(baseRunOptions())

      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const toolResultMsg = secondCallMessages[2]
      const content = toolResultMsg.content as Anthropic.ToolResultBlockParam[]
      expect(content[0].content).toBe('Tool execution failed: string error')
      expect((content[0] as Anthropic.ToolResultBlockParam & { is_error?: boolean }).is_error).toBe(true)
    })
  })

  describe('userContext', () => {
    it('userContext.workspaceRoot가 있으면 시스템 프롬프트에 포함된다', async () => {
      createFn.mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run({
        ...baseRunOptions(),
        userContext: { userId: 'u1', projectId: 'p1', workspaceRoot: '/my-workspace' },
      } as Parameters<typeof runner.run>[0])

      const systemPrompt = createFn.mock.calls[0][0].system as string
      expect(systemPrompt).toContain('/my-workspace')
    })
  })

  describe('publishStatus 실패 격리', () => {
    it('publishStatus 실패 시 루프가 계속 진행된다', async () => {
      // producer.publish가 첫 번째 호출에서 실패해도 루프가 중단되지 않아야 한다
      mockProducer.publish.mockRejectedValueOnce(new Error('Redis 연결 실패'))
      mockProducer.publish.mockResolvedValue(undefined)

      registry.register({
        name: 'develop_code',
        description: 'Develop code',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockResolvedValue({ success: true }),
      })

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [
            makeToolUseBlock('tu-ps', 'develop_code', { projectPath: '/workspace' }),
          ]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      // publishStatus 실패에도 불구하고 run()이 정상 완료되어야 한다
      const result = await runner.run(baseRunOptions())
      expect(result).toBe('완료')
    })
  })
})

describe('MAX_ITERATIONS 검증 (parseMaxIterations)', () => {
  it('NaN 값이면 에러를 throw한다', () => {
    expect(() => parseMaxIterations('not-a-number')).toThrow(
      /MANAGER_MAX_ITERATIONS must be a positive integer/,
    )
  })

  it('0이면 에러를 throw한다', () => {
    expect(() => parseMaxIterations('0')).toThrow(
      /MANAGER_MAX_ITERATIONS must be a positive integer/,
    )
  })

  it('음수이면 에러를 throw한다', () => {
    expect(() => parseMaxIterations('-5')).toThrow(
      /MANAGER_MAX_ITERATIONS must be a positive integer/,
    )
  })
})
