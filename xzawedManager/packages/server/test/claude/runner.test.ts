import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { SessionStore } from '../../src/sessions/session.store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { ToolHandler } from '../../src/tools/handler.interface.js'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

const mockPublish = vi.fn().mockResolvedValue('1234-0')
vi.mock('../../src/streams/producer.js', () => ({
  StreamProducer: class {
    publish = mockPublish
  },
}))

async function loadModules() {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { StreamProducer } = await import('../../src/streams/producer.js')
  const { ClaudeRunner } = await import('../../src/claude/runner.js')
  return { Anthropic, StreamProducer, ClaudeRunner }
}

function makeFakeHandler(execute = vi.fn().mockResolvedValue({})): ToolHandler {
  return {
    name: 'plan_task',
    description: 'Plan a task',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute,
  }
}

describe('ClaudeRunner', () => {
  let mods: Awaited<ReturnType<typeof loadModules>>

  beforeAll(async () => {
    mods = await loadModules()
  })

  beforeEach(() => {
    mockCreate.mockReset()
    mockPublish.mockClear()
  })

  function makeRunner(registry: ToolRegistry) {
    const { Anthropic, StreamProducer, ClaudeRunner } = mods
    const runner = new ClaudeRunner(new Anthropic({ apiKey: 'test' }), 'claude-haiku-4-5-20251001', registry)
    const sessionStore = new SessionStore()
    const producer = new StreamProducer('redis://localhost:6379')
    return { runner, sessionStore, producer }
  }

  it('returns final text when Claude responds with end_turn immediately', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Task analysis complete.' }],
    })

    const { runner, sessionStore, producer } = makeRunner(new ToolRegistry())
    sessionStore.create('sess-1')

    const result = await runner.run({
      sessionId: 'sess-1',
      intent: 'analyze project',
      context: {},
      producer,
      sessionStore,
    })

    expect(result).toBe('Task analysis complete.')
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('executes tool and continues loop when Claude uses a tool', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'I will plan this.' },
          { type: 'tool_use', id: 'tool-1', name: 'plan_task', input: { intent: 'build app', context: {} } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Planning complete.' }],
      })

    const mockToolExecute = vi.fn().mockResolvedValue({ steps: ['step1'], estimatedTime: '1h' })
    const registry = new ToolRegistry()
    registry.register(makeFakeHandler(mockToolExecute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-1')
    sessionStore.setGateDefaultMode('sess-1', 'auto') // 승인 게이트 비대상 흐름 검증

    const result = await runner.run({
      sessionId: 'sess-1',
      intent: 'build app',
      context: {},
      producer,
      sessionStore,
    })

    expect(result).toBe('Planning complete.')
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockToolExecute).toHaveBeenCalledWith({ intent: 'build app', context: {} }, 'sess-1', undefined)
    expect(mockPublish).toHaveBeenCalledTimes(3)
    expect(mockPublish.mock.calls[0]![0]).toMatchObject({ type: 'status_update', payload: { agentId: 'manager' } })
  })

  it('status_update가 세션 누적 비용(costUsd)·토큰을 실어 보낸다 (G5)', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'planning' },
          { type: 'tool_use', id: 'tool-1', name: 'plan_task', input: { intent: 'x', context: {} } },
        ],
        usage: { input_tokens: 1000, output_tokens: 500 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 200, output_tokens: 100 },
      })

    const registry = new ToolRegistry()
    registry.register(makeFakeHandler(vi.fn().mockResolvedValue({ steps: [] })))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-cost')
    sessionStore.setGateDefaultMode('sess-cost', 'auto')

    await runner.run({ sessionId: 'sess-cost', intent: 'x', context: {}, producer, sessionStore })

    // 첫 Claude 호출(usage) 후 발행된 status_update가 세션 누적 비용·토큰을 실어야 한다.
    const withCost = mockPublish.mock.calls
      .map((c) => c[0] as { type: string; payload: { costUsd?: number; tokensUsed?: number } })
      .find((m) => m.type === 'status_update' && typeof m.payload.costUsd === 'number' && m.payload.costUsd > 0)
    expect(withCost).toBeDefined()
    expect(withCost!.payload.tokensUsed).toBeGreaterThan(0)
  })

  it('calls Claude with registry tools plus request_info tool', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
    })

    const registry = new ToolRegistry()
    registry.register(makeFakeHandler())
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-tools')

    await runner.run({
      sessionId: 'sess-tools',
      intent: 'test tools',
      context: {},
      producer,
      sessionStore,
    })

    const callArgs = mockCreate.mock.calls[0]![0] as { tools: Array<{ name: string }> }
    const toolNames = callArgs.tools.map((t) => t.name)
    expect(toolNames).toContain('plan_task')
    expect(toolNames).toContain('request_info')
  })

  it('throws when iteration limit exceeded', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tool-loop', name: 'plan_task', input: { intent: 'loop', context: {} } },
      ],
    })

    const registry = new ToolRegistry()
    registry.register(makeFakeHandler())
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-loop')
    sessionStore.setGateDefaultMode('sess-loop', 'auto') // 승인 게이트 비대상 흐름 검증

    await expect(runner.run({
      sessionId: 'sess-loop',
      intent: 'loop forever',
      context: {},
      producer,
      sessionStore,
    })).rejects.toThrow('exceeded')
  })

  it('wraps unknown tool error as is_error tool_result and continues loop', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tool-3', name: 'nonexistent_tool', input: {} },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Error handled.' }],
      })

    const { runner, sessionStore, producer } = makeRunner(new ToolRegistry())
    sessionStore.create('sess-3')

    const result = await runner.run({
      sessionId: 'sess-3',
      intent: 'test',
      context: {},
      producer,
      sessionStore,
    })
    expect(result).toBe('Error handled.')

    const secondCallMessages = mockCreate.mock.calls[1][0].messages as Array<{ role: string; content: unknown }>
    const toolResultMsg = secondCallMessages[secondCallMessages.length - 1]
    const content = toolResultMsg.content as Array<{ type: string; is_error?: boolean; content?: string }>
    expect(content[0].is_error).toBe(true)
    expect(content[0].content).toContain('Unknown tool: nonexistent_tool')
  })

  it.each<[string, object[], string, string]>([
    [
      'CQ-2: request_info missing question field',
      [{ type: 'tool_use', id: 'ri-1', name: 'request_info', input: { notQuestion: 42 } }],
      'sess-cq2',
      "request_info tool call missing required 'question' field",
    ],
    [
      'CQ-3: stop_reason tool_use but no tool_use blocks',
      [{ type: 'text', text: 'Hmm, no tools needed.' }],
      'sess-cq3',
      'stop_reason was tool_use but no tool_use blocks found in response',
    ],
  ])('%s', async (_, content, sessionId, errorMsg) => {
    mockCreate.mockResolvedValueOnce({ stop_reason: 'tool_use', content })
    const { runner, sessionStore, producer } = makeRunner(new ToolRegistry())
    sessionStore.create(sessionId)
    await expect(runner.run({
      sessionId,
      intent: 'test',
      context: {},
      producer,
      sessionStore,
    })).rejects.toThrow(errorMsg)
  })
})
