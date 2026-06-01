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
import { AgentQueryError } from '../tools/errors.js'
import { SessionStore } from '../sessions/session.store.js'

/** 조건이 참이 될 때까지 macrotask로 양보하며 폴링한다. */
async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setImmediate(r))
  }
}

const GATED_SCHEMA = { type: 'object' as const, properties: {}, required: [] }

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
let mockSessionStore: { waitForInfo: ReturnType<typeof vi.fn>; getGateConfig: ReturnType<typeof vi.fn> }
let runner: ClaudeRunner
let client: Anthropic
let createFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()

  registry = new ToolRegistry()
  mockProducer = { publish: vi.fn().mockResolvedValue(undefined) }
  // 게이트 비대상 동작을 보존하기 위해 기본 auto(게이트 우회). 게이트 검증 테스트는 실제 SessionStore 사용.
  mockSessionStore = {
    waitForInfo: vi.fn(),
    getGateConfig: vi.fn().mockReturnValue({ defaultMode: 'auto', overrides: {} }),
  }

  // Construct a fresh Anthropic mock instance
  const create = vi.fn()
  AnthropicMock.mockImplementation(() => ({
    messages: { create },
  }) as unknown as Anthropic)

  client = new AnthropicDefault()
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

  describe('에이전트 간 질의(AgentQuery)', () => {
    it('AgentQueryError 발생 시 대상 에이전트를 호출하고 원 에이전트를 재실행한다', async () => {
      const designExec = vi.fn()
        .mockRejectedValueOnce(new AgentQueryError('developer', '재고 표시 가능?', 'active_request'))
        .mockResolvedValueOnce({ content: '디자인 완료' })
      const developExec = vi.fn().mockResolvedValue({ answer: '가능, 5초 폴링' })

      registry.register({
        name: 'design_ui', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: designExec,
      } as never)
      registry.register({
        name: 'develop_code', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: developExec,
      } as never)

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-aq', 'design_ui', { spec: 'cart' })]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run(baseRunOptions())

      // 대상(developer)에게 질문이 전달됨
      expect(developExec).toHaveBeenCalledWith(
        expect.objectContaining({ query: '재고 표시 가능?', queryKind: 'active_request' }),
        'sess-1',
        undefined,
      )
      // 원 에이전트(design_ui)가 개발자 답을 context로 재실행됨
      expect(designExec).toHaveBeenCalledTimes(2)
      expect(designExec.mock.calls[1][0]).toMatchObject({
        clarificationContext: expect.stringContaining('가능'),
      })
    })

    it('알 수 없는 대상 에이전트면 is_error 결과를 반환한다', async () => {
      const designExec = vi.fn()
        .mockRejectedValueOnce(new AgentQueryError('nobody', '?', 'active_request'))

      registry.register({
        name: 'design_ui', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: designExec,
      } as never)

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-aq2', 'design_ui', {})]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('종료')]))

      await runner.run(baseRunOptions())

      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const toolResultMsg = secondCallMessages[secondCallMessages.length - 1]
      const content = toolResultMsg.content as Array<Anthropic.ToolResultBlockParam & { is_error?: boolean }>
      expect(content[0].is_error).toBe(true)
      expect(content[0].content).toContain('Unknown query target agent: nobody')
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

  describe('승인 게이트', () => {
    function registerPlan(execute: ReturnType<typeof vi.fn>): void {
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute } as never)
    }
    function planThenEnd(): void {
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('t1', 'plan_task', { intent: 'x' })]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))
    }
    function findApproval(): unknown {
      return mockProducer.publish.mock.calls
        .map((c) => c[0] as { payload?: { approval?: unknown } })
        .find((m) => m.payload?.approval)?.payload?.approval
    }

    it('manual: 승인 전까지 다음 단계로 진행하지 않고, 승인 시 결과를 반환한다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획 산출' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      // 승인 대기 중 — 다음 Claude 호출(2번째)이 아직 일어나지 않아야 한다
      expect(createFn).toHaveBeenCalledTimes(1)
      expect(findApproval()).toMatchObject({ stage: 'plan_task', mode: 'manual' })

      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP
      expect(exec).toHaveBeenCalledTimes(1) // 재실행 없음
    })

    it('배포(deploy_project)는 세션이 auto여도 항상 승인 게이트를 거친다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      store.setGateDefaultMode('sess-1', 'auto') // 전역 auto여도 배포는 manual
      const exec = vi.fn().mockResolvedValue({ content: '배포 준비됨' })
      registry.register({ name: 'deploy_project', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('d1', 'deploy_project', { repo: 'x' })]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      expect(findApproval()).toMatchObject({ stage: 'deploy_project', mode: 'manual' })
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP
      expect(exec).toHaveBeenCalledTimes(1)
    })

    it('auto override: 게이트 없이 즉시 통과한다(approval 미발행)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      store.setGateOverride('sess-1', 'plan_task', 'auto')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      planThenEnd()

      await runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      expect(findApproval()).toBeUndefined()
      expect(exec).toHaveBeenCalledTimes(1)
    })

    it('approve + rememberAuto: 같은 단계가 이후 자동 통과한다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      // plan_task 두 번 호출 후 end_turn
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('t1', 'plan_task', { intent: 'x' })]))
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('t2', 'plan_task', { intent: 'y' })]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      // 1번째 호출: 게이트 대기 → rememberAuto로 승인
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve', rememberAuto: true }))
      await runP

      // override가 auto로 설정됨 → 2번째 호출은 게이트 없이 통과(approval 1회만 발행)
      expect(store.getGateConfig('sess-1').overrides['plan_task']).toBe('auto')
      const approvals = mockProducer.publish.mock.calls
        .map((c) => c[0] as { payload?: { approval?: unknown } })
        .filter((m) => m.payload?.approval)
      expect(approvals).toHaveLength(1)
      expect(exec).toHaveBeenCalledTimes(2)
    })

    it('revise: 피드백으로 같은 도구를 재실행한 뒤 다시 게이트로 온다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn()
        .mockResolvedValueOnce({ content: '초안' })
        .mockResolvedValueOnce({ content: '수정본' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'revise', feedback: '더 자세히' }))
      await waitFor(() => exec.mock.calls.length === 2)
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP

      expect(exec).toHaveBeenCalledTimes(2)
      expect(exec.mock.calls[1]?.[0]).toMatchObject({ clarificationContext: '더 자세히' })
    })

    it('abort: 세션이 종료되고 후속 단계가 실행되지 않는다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'abort' }))

      await expect(runP).rejects.toThrow(/aborted/i)
      expect(createFn).toHaveBeenCalledTimes(1) // 다음 단계(2번째 Claude 호출) 미실행
    })
  })

  describe('도메인 지식 위키', () => {
    function makeKnowledgeRepo() {
      return {
        recentByProject: vi.fn().mockResolvedValue([{ content: '기존 지식', sourceAgent: 'planner' }]),
        insertMany: vi.fn().mockResolvedValue(undefined),
      }
    }
    const userCtx = { userId: 'u1', projectId: 'proj-1', workspaceRoot: '/ws' }
    function planAutoSession() {
      const store = new SessionStore()
      store.create('sess-1')
      store.setGateDefaultMode('sess-1', 'auto')
      return store
    }
    function planThenEndWithCtx() {
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('t1', 'plan_task', { intent: 'x', context: {} })]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))
    }

    it('호출 전 최근 지식을 context.domainKnowledge로 주입한다', async () => {
      const repo = makeKnowledgeRepo()
      const store = planAutoSession()
      const exec = vi.fn().mockResolvedValue({ steps: [], estimatedTime: '1h' })
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      planThenEndWithCtx()

      const r = new ClaudeRunner(client, 'm', registry, repo as never)
      await r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: userCtx } as Parameters<typeof r.run>[0])

      expect(repo.recentByProject).toHaveBeenCalledWith('proj-1', expect.any(Number))
      const passedInput = exec.mock.calls[0]?.[0] as { context: { domainKnowledge?: unknown[] } }
      expect(passedInput.context.domainKnowledge).toEqual([{ content: '기존 지식', sourceAgent: 'planner' }])
    })

    it('게이트 통과 후 result.knowledge를 저장한다(sourceAgent=도구명)', async () => {
      const repo = makeKnowledgeRepo()
      const store = planAutoSession()
      const exec = vi.fn().mockResolvedValue({ steps: [], estimatedTime: '1h', knowledge: ['결제는 Stripe'] })
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      planThenEndWithCtx()

      const r = new ClaudeRunner(client, 'm', registry, repo as never)
      await r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: userCtx } as Parameters<typeof r.run>[0])

      expect(repo.insertMany).toHaveBeenCalledWith('proj-1', [{ content: '결제는 Stripe', sourceAgent: 'plan_task' }])
    })

    it('repo가 없으면 주입·저장을 건너뛰고 기존 흐름을 유지한다', async () => {
      const store = planAutoSession()
      const exec = vi.fn().mockResolvedValue({ steps: [], estimatedTime: '1h', knowledge: ['x'] })
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      planThenEndWithCtx()

      const r = new ClaudeRunner(client, 'm', registry) // repo 없음
      await r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: userCtx } as Parameters<typeof r.run>[0])
      expect(exec).toHaveBeenCalledTimes(1)
      const passedInput = exec.mock.calls[0]?.[0] as { context?: { domainKnowledge?: unknown } }
      expect(passedInput.context?.domainKnowledge).toBeUndefined()
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
