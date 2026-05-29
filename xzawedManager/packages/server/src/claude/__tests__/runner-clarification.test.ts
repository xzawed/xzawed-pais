import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { ClarificationNeededError } from '../../tools/errors.js'
import { SessionStore } from '../../sessions/session.store.js'
import { ToolRegistry } from '../../tools/registry.js'
import type { ToolHandler } from '../../tools/handler.interface.js'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

const mockPublish = vi.fn().mockResolvedValue('0-1')
vi.mock('../../streams/producer.js', () => ({
  StreamProducer: class {
    publish = mockPublish
  },
}))

async function loadModules() {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { ClaudeRunner } = await import('../runner.js')
  const { StreamProducer } = await import('../../streams/producer.js') as {
    StreamProducer: new (url: string) => { publish: typeof mockPublish }
  }
  return { Anthropic, ClaudeRunner, StreamProducer }
}

function makeHandler(name: string, execute: ToolHandler['execute']): ToolHandler {
  return {
    name,
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute,
  }
}

describe('ClarificationNeededError 동작', () => {
  it('ClarificationNeededError는 Error를 상속하며 content 속성을 가진다', () => {
    const err = new ClarificationNeededError('어떤 언어로 작성할까요?')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ClarificationNeededError)
    expect(err.content).toBe('어떤 언어로 작성할까요?')
    expect(err.uiSpec).toBeUndefined()
  })

  it('에이전트 실행 실패 시 재실행 로직 시뮬레이션', async () => {
    let callCount = 0
    const mockExecute = vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
      callCount++
      if (callCount === 1) throw new ClarificationNeededError('어떤 언어로 작성할까요?')
      return { content: `clarification applied: ${String(input['clarificationContext'])}`, steps: [] }
    })

    const mockWaitForInfo = vi.fn().mockResolvedValue('Python')

    // 1차 실행: ClarificationNeededError
    let caught: unknown
    try {
      await mockExecute({ task: 'test' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ClarificationNeededError)

    // waitForInfo로 답변 획득
    const answer = await mockWaitForInfo('session-1')
    expect(answer).toBe('Python')

    // 2차 실행 (명확화 포함)
    const result = await mockExecute({ task: 'test', clarificationContext: answer })
    expect(result.content).toBe('clarification applied: Python')
    expect(callCount).toBe(2)
  })
})

describe('ClaudeRunner — ClarificationNeededError / design_ui 통합', () => {
  let mods: Awaited<ReturnType<typeof loadModules>>

  beforeAll(async () => {
    mods = await loadModules()
  })

  beforeEach(() => {
    mockCreate.mockReset()
    mockPublish.mockClear()
  })

  function makeRunner(registry: ToolRegistry) {
    const { Anthropic, ClaudeRunner, StreamProducer } = mods
    const runner = new ClaudeRunner(new Anthropic({ apiKey: 'test' }), 'claude-test', registry)
    const sessionStore = new SessionStore()
    const producer = new StreamProducer('redis://localhost:6379')
    return { runner, sessionStore, producer }
  }

  it('ClarificationNeededError 발생 시 info_request 발행 후 waitForInfo를 기다린다', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'design_ui', input: { task: 'create form' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done after clarification.' }],
      })

    let callCount = 0
    const execute = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new ClarificationNeededError('어떤 색상을 사용할까요?')
      return { content: '컴포넌트 설계 완료', steps: [] }
    })

    const registry = new ToolRegistry()
    registry.register(makeHandler('design_ui', execute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-clarify-1')

    setImmediate(() => sessionStore.resolveInfo('sess-clarify-1', 'blue'))

    const result = await runner.run({
      sessionId: 'sess-clarify-1',
      intent: 'design UI',
      context: {},
      producer,
      sessionStore,
    })

    expect(result).toBe('Done after clarification.')
    const infoRequestCall = mockPublish.mock.calls.find(
      (call) => (call[0] as { type: string }).type === 'info_request',
    )
    expect(infoRequestCall).toBeDefined()
    const payload = (infoRequestCall![0] as { payload: { content: string } }).payload
    expect(payload.content).toBe('어떤 색상을 사용할까요?')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('ClarificationNeededError에 uiSpec이 있으면 publish payload에 uiSpec 포함', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-2', name: 'design_ui', input: { task: 'form' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done with uiSpec.' }],
      })

    const uiSpec = { type: 'form' as const, title: '색상 선택', fields: [] }
    let callCount = 0
    const execute = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new ClarificationNeededError('색상 선택', uiSpec)
      return { content: '완료' }
    })

    const registry = new ToolRegistry()
    registry.register(makeHandler('design_ui', execute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-clarify-uispec')

    setImmediate(() => sessionStore.resolveInfo('sess-clarify-uispec', 'red'))

    await runner.run({
      sessionId: 'sess-clarify-uispec',
      intent: 'design',
      context: {},
      producer,
      sessionStore,
    })

    const infoRequestCall = mockPublish.mock.calls.find(
      (call) => (call[0] as { type: string }).type === 'info_request',
    )
    expect(infoRequestCall).toBeDefined()
    const payload = (infoRequestCall![0] as { payload: { uiSpec?: unknown } }).payload
    expect(payload.uiSpec).toEqual(uiSpec)
  })

  it('clarificationContext를 포함하여 핸들러를 재실행한다', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-3', name: 'design_ui', input: { task: 'card' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Rerun done.' }],
      })

    let callCount = 0
    const receivedInputs: Array<Record<string, unknown>> = []
    const execute = vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
      callCount++
      receivedInputs.push(input)
      if (callCount === 1) throw new ClarificationNeededError('색상?')
      return { content: '완료' }
    })

    const registry = new ToolRegistry()
    registry.register(makeHandler('design_ui', execute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-rerun')

    setImmediate(() => sessionStore.resolveInfo('sess-rerun', 'green'))

    await runner.run({
      sessionId: 'sess-rerun',
      intent: 'design card',
      context: {},
      producer,
      sessionStore,
    })

    expect(receivedInputs[1]).toMatchObject({ task: 'card', clarificationContext: 'green' })
  })

  it('재실행 실패 시 is_error: true tool_result를 반환하고 루프를 계속한다', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-4', name: 'design_ui', input: { task: 'widget' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Error handled by Claude.' }],
      })

    let callCount = 0
    const execute = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new ClarificationNeededError('스타일?')
      throw new Error('재실행 실패 에러')
    })

    const registry = new ToolRegistry()
    registry.register(makeHandler('design_ui', execute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-retry-fail')

    setImmediate(() => sessionStore.resolveInfo('sess-retry-fail', 'minimal'))

    const result = await runner.run({
      sessionId: 'sess-retry-fail',
      intent: 'widget',
      context: {},
      producer,
      sessionStore,
    })

    expect(result).toBe('Error handled by Claude.')

    const secondCallMessages = mockCreate.mock.calls[1][0].messages as Array<{
      role: string
      content: unknown
    }>
    const toolResultMsg = secondCallMessages[secondCallMessages.length - 1]
    const content = toolResultMsg.content as Array<{ type: string; is_error?: boolean; content?: string }>
    expect(content[0].is_error).toBe(true)
    expect(content[0].content).toContain('재실행 실패 에러')
  })

  it('design_ui 결과에 uiSpec이 있으면 status_update에 uiSpec을 포함하여 별도 publish 호출', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-5', name: 'design_ui', input: { task: 'dashboard' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Dashboard designed.' }],
      })

    const uiSpec = { type: 'mockup_viewer' as const, title: '대시보드', content: 'preview' }
    const execute = vi.fn().mockResolvedValue({
      content: 'UI 설계 완료',
      uiSpec,
    })

    const registry = new ToolRegistry()
    registry.register(makeHandler('design_ui', execute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-design-ui')

    await runner.run({
      sessionId: 'sess-design-ui',
      intent: 'design dashboard',
      context: {},
      producer,
      sessionStore,
    })

    const uiSpecPublishCall = mockPublish.mock.calls.find((call) => {
      const msg = call[0] as { type: string; payload: { uiSpec?: unknown } }
      return msg.type === 'status_update' && msg.payload.uiSpec !== undefined
    })
    expect(uiSpecPublishCall).toBeDefined()
    expect(
      (uiSpecPublishCall![0] as { payload: { uiSpec: unknown } }).payload.uiSpec,
    ).toEqual(uiSpec)
  })

  it('design_ui 결과에 uiSpec이 없으면 uiSpec 없는 일반 status_update만 발행된다', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-6', name: 'design_ui', input: { task: 'button' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Button designed.' }],
      })

    const execute = vi.fn().mockResolvedValue({ content: 'UI 설계 완료' })

    const registry = new ToolRegistry()
    registry.register(makeHandler('design_ui', execute))
    const { runner, sessionStore, producer } = makeRunner(registry)
    sessionStore.create('sess-design-no-uispec')

    await runner.run({
      sessionId: 'sess-design-no-uispec',
      intent: 'design button',
      context: {},
      producer,
      sessionStore,
    })

    const uiSpecPublishCall = mockPublish.mock.calls.find((call) => {
      const msg = call[0] as { payload?: { uiSpec?: unknown } }
      return msg.payload?.uiSpec !== undefined
    })
    expect(uiSpecPublishCall).toBeUndefined()
  })
})
