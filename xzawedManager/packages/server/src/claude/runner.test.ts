import { vi, describe, it, expect, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn()
  return {
    default: vi.fn().mockImplementation(function () { return ({
      messages: { create },
    }) }),
    __create: create,
  }
})

import AnthropicDefault from '@anthropic-ai/sdk'
import { ClaudeRunner, parseMaxIterations, parsePositiveInt } from './runner.js'
import { ToolRegistry } from '../tools/registry.js'
import { AgentQueryError, ClarificationNeededError } from '../tools/errors.js'
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
  AnthropicMock.mockImplementation(function () {
    return ({ messages: { create } }) as unknown as Anthropic
  })

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

describe('parsePositiveInt (게이트 상한 파싱 — NaN/0/음수 방어)', () => {
  it('유효한 양의 정수는 그대로 반환', () => {
    expect(parsePositiveInt('3', 5)).toBe(3)
    expect(parsePositiveInt('10', 5)).toBe(10)
  })
  it('미설정(undefined)은 기본값', () => {
    expect(parsePositiveInt(undefined, 5)).toBe(5)
  })
  it('비숫자 문자열은 기본값(NaN→상한 무력화 방지)', () => {
    expect(parsePositiveInt('abc', 5)).toBe(5)
  })
  it('0·음수·빈문자열은 기본값(상한이 0이면 fail-safe 무력화)', () => {
    expect(parsePositiveInt('0', 5)).toBe(5)
    expect(parsePositiveInt('-2', 5)).toBe(5)
    expect(parsePositiveInt('', 5)).toBe(5)
  })
})

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

    it('tool 입력이 inputSchema를 위반하면 디스패치 없이 is_error를 반환한다', async () => {
      const exec = vi.fn().mockResolvedValue({ content: '결과' })
      registry.register({
        name: 'plan_task',
        description: 'plan',
        inputSchema: { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'] },
        execute: exec,
      } as never)
      // LLM이 required 'intent' 없이 호출
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('tu-bad', 'plan_task', { context: {} })]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('재시도 처리')]))

      const result = await runner.run(baseRunOptions())
      expect(result).toBe('재시도 처리')
      // 디스패치되지 않음(핸들러 미호출)
      expect(exec).not.toHaveBeenCalled()
      // is_error tool_result에 검증 위반 메시지
      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const lastMsg = secondCallMessages[secondCallMessages.length - 1]
      const content = lastMsg.content as Array<Anthropic.ToolResultBlockParam & { is_error?: boolean }>
      expect(content[0].is_error).toBe(true)
      expect(String(content[0].content)).toContain('Invalid input')
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

      // 대상(developer)에게 질문이 전달됨 — query/queryKind + 답변자 스키마가 읽는 context 포함
      expect(developExec).toHaveBeenCalledWith(
        expect.objectContaining({ query: '재고 표시 가능?', queryKind: 'active_request', context: {} }),
        'sess-1',
        undefined,
      )
      // 원 에이전트(design_ui)가 개발자 답을 context로 재실행됨
      expect(designExec).toHaveBeenCalledTimes(2)
      expect(designExec.mock.calls[1][0]).toMatchObject({
        clarificationContext: expect.stringContaining('가능'),
      })
    })

    it('교차질의 라우팅 payload에 답변자 스키마 필수 필드 placeholder를 함께 보낸다', async () => {
      // 회귀 방지: 라우팅이 {query, queryKind}만 보내면 답변자 BaseConsumer의 safeParse가
      // 필수 필드(projectPath·target·severity·artifacts·intent·priority·context) 누락으로 실패 →
      // invalid_schema DLQ → 응답 없음 → 120초 타임아웃. 모든 답변자 스키마의 필수 필드 합집합을
      // placeholder로 채워 어느 답변자(planner/designer/tester/builder/security)로 라우팅돼도 검증을 통과시킨다.
      const planExec = vi.fn()
        .mockRejectedValueOnce(new AgentQueryError('security', '이 인증 흐름 안전한가?', 'cross_check'))
        .mockResolvedValueOnce({ content: '계획 완료' })
      const securityExec = vi.fn().mockResolvedValue({ content: '안전함' })

      registry.register({
        name: 'plan_task', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: planExec,
      } as never)
      registry.register({
        name: 'security_audit', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: securityExec,
      } as never)

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-aq3', 'plan_task', { intent: 'x' })]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run(baseRunOptions())

      expect(securityExec).toHaveBeenCalledTimes(1)
      const payload = securityExec.mock.calls[0][0] as Record<string, unknown>
      // 질의 모드 필드
      expect(payload['query']).toBe('이 인증 흐름 안전한가?')
      expect(payload['queryKind']).toBe('cross_check')
      // 답변자 스키마 필수 필드 placeholder (전 답변자 스키마 합집합)
      expect(payload['context']).toEqual({})
      expect(payload['projectPath']).toBe('')
      expect(payload['target']).toBe('development')
      expect(payload['severity']).toBe('low')
      expect(payload['artifacts']).toEqual([])
      expect(payload['intent']).toBe('이 인증 흐름 안전한가?')
      expect(payload['priority']).toBe('normal')
    })

    it('교차질의 질문이 4000자를 초과해도 intent placeholder를 4000자로 잘라 보낸다', async () => {
      // planner/designer의 intent는 z.string().min(1).max(4000). err.question은 상한이 없어
      // 그대로 intent에 넣으면 4000자 초과 질의가 planner/designer로 라우팅될 때 safeParse 실패
      // → invalid_schema DLQ → 타임아웃(원래 버그 재발). 4000자로 잘라 통과시킨다.
      const longQuestion = 'x'.repeat(4500)
      const designExec = vi.fn()
        .mockRejectedValueOnce(new AgentQueryError('planner', longQuestion, 'cross_check'))
        .mockResolvedValueOnce({ content: '디자인 완료' })
      const planExec = vi.fn().mockResolvedValue({ content: '기획 의견' })

      registry.register({
        name: 'design_ui', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: designExec,
      } as never)
      registry.register({
        name: 'plan_task', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: planExec,
      } as never)

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-long', 'design_ui', {})]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run(baseRunOptions())

      const intent = (planExec.mock.calls[0][0] as Record<string, unknown>)['intent'] as string
      expect(intent.length).toBeLessThanOrEqual(4000)
      expect(intent.length).toBeGreaterThanOrEqual(1)
    })

    it('교차질의 질문이 비어도 intent placeholder는 비지 않게 채운다', async () => {
      // planner/designer의 intent .min(1) 위반(빈 문자열) 방어 — 빈 질문이어도 DLQ/타임아웃을 막는다.
      const designExec = vi.fn()
        .mockRejectedValueOnce(new AgentQueryError('planner', '', 'active_request'))
        .mockResolvedValueOnce({ content: '디자인 완료' })
      const planExec = vi.fn().mockResolvedValue({ content: '기획 의견' })

      registry.register({
        name: 'design_ui', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: designExec,
      } as never)
      registry.register({
        name: 'plan_task', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: planExec,
      } as never)

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-empty', 'design_ui', {})]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('완료')]))

      await runner.run(baseRunOptions())

      const intent = (planExec.mock.calls[0][0] as Record<string, unknown>)['intent'] as string
      expect(intent.length).toBeGreaterThanOrEqual(1)
    })

    it('답변 불가 에이전트(watcher)로의 교차질의는 디스패치 없이 is_error로 즉시 거부한다', async () => {
      // watcher는 Claude 미사용·답변 불가(createCollaborativeHandler 미적용). 라우팅하면 watch_changes
      // 스키마(triggers 필수) 검증 실패 → DLQ → 120초 타임아웃이며, payload에 triggers를 넣으면
      // 실제 파일 감시를 시작하는 부작용이 발생한다. 따라서 라우팅 단계에서 즉시 거부해야 한다.
      const designExec = vi.fn()
        .mockRejectedValueOnce(new AgentQueryError('watcher', '이 파일 감시돼?', 'active_request'))
      const watchExec = vi.fn().mockResolvedValue({ content: 'should-not-run' })

      registry.register({
        name: 'design_ui', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: designExec,
      } as never)
      registry.register({
        name: 'watch_changes', description: '', inputSchema: { type: 'object', properties: {}, required: [] },
        execute: watchExec,
      } as never)

      createFn
        .mockResolvedValueOnce(
          makeMessage('tool_use', [makeToolUseBlock('tu-watch', 'design_ui', {})]),
        )
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('종료')]))

      await runner.run(baseRunOptions())

      // watcher 핸들러는 절대 호출되지 않는다(부작용·타임아웃 방지)
      expect(watchExec).not.toHaveBeenCalled()
      const secondCallMessages = createFn.mock.calls[1][0].messages as Anthropic.MessageParam[]
      const toolResultMsg = secondCallMessages[secondCallMessages.length - 1]
      const content = toolResultMsg.content as Array<Anthropic.ToolResultBlockParam & { is_error?: boolean }>
      expect(content[0].is_error).toBe(true)
      expect(content[0].content).toContain('watcher')
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

    it('design_ui 승인 게이트(manual) publish에 uiSpec(components 포함)을 첨부한다', async () => {
      mockSessionStore.getGateConfig.mockReturnValue({ defaultMode: 'manual', overrides: {} })
      mockSessionStore.waitForInfo.mockResolvedValueOnce('{"decision":"approve"}')
      registry.register({
        name: 'design_ui',
        description: '',
        inputSchema: GATED_SCHEMA,
        execute: vi.fn().mockResolvedValue({
          components: [{ name: 'Card', description: 'c', props: {} }],
          uiSpec: { type: 'mockup_viewer', title: 'Demo' },
          content: '요약',
        }),
      })
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('tu-d', 'design_ui', {})]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))

      await runner.run(baseRunOptions())

      const infoReq = (mockProducer.publish.mock.calls as Array<[{ type: string; payload: Record<string, unknown> }]>)
        .map((c) => c[0])
        .find((m) => m.type === 'info_request')
      expect(infoReq?.payload['uiSpec']).toBeDefined()
      expect((infoReq?.payload['uiSpec'] as { components: unknown[] }).components).toHaveLength(1)
      expect((infoReq?.payload['approval'] as { stage: string }).stage).toBe('design_ui')
    })

    it('design_ui가 아닌 게이트 단계는 uiSpec을 첨부하지 않는다', async () => {
      mockSessionStore.getGateConfig.mockReturnValue({ defaultMode: 'manual', overrides: {} })
      mockSessionStore.waitForInfo.mockResolvedValueOnce('{"decision":"approve"}')
      registry.register({
        name: 'plan_task', description: '', inputSchema: GATED_SCHEMA,
        execute: vi.fn().mockResolvedValue({ content: '계획' }),
      })
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('tu-p', 'plan_task', {})]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))

      await runner.run(baseRunOptions())

      const infoReq = (mockProducer.publish.mock.calls as Array<[{ type: string; payload: Record<string, unknown> }]>)
        .map((c) => c[0])
        .find((m) => m.type === 'info_request')
      expect(infoReq?.payload['uiSpec']).toBeUndefined()
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

    it('gateMode가 주어지면 setGateDefaultMode로 세션 기본 모드를 설정한다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      // 도구 없이 즉시 end_turn — 게이트 미개입, 기본 모드 설정만 검증
      createFn.mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))

      await runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, gateMode: 'auto' })

      expect(store.getGateConfig('sess-1').defaultMode).toBe('auto')
    })

    it('gateMode=auto면 게이트 없이 통과한다(승인 요청 미발행)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획 산출' })
      registerPlan(exec)
      planThenEnd()

      await runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, gateMode: 'auto' })

      expect(exec).toHaveBeenCalledTimes(1)
      expect(findApproval()).toBeUndefined()
    })

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

    it('명확화 재실행 결과도 승인 게이트를 거친다(우회 방지)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      // plan_task: 1차 실행은 명확화 필요(throw), 명확화 응답으로 재실행 시 결과 반환
      const exec = vi.fn()
        .mockRejectedValueOnce(new ClarificationNeededError('어떤 DB를 쓸까요?'))
        .mockResolvedValueOnce({ content: '계획: Postgres' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      // 1) 명확화 대기 → 응답
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', 'Postgres')
      // 2) 재실행 결과가 게이트로 진입해 승인 대기에 다시 들어가야 한다(우회되면 곧장 완료됨)
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP

      expect(exec).toHaveBeenCalledTimes(2) // 1차(명확화 throw) + 재실행
      // 재실행 결과(plan_task)에 대한 승인 요청(approval) info_request가 발행됨
      const approvalMsgs = mockProducer.publish.mock.calls
        .map((c) => c[0] as { payload?: { approval?: { stage?: string } } })
        .filter((m) => m.payload?.approval?.stage === 'plan_task')
      expect(approvalMsgs.length).toBeGreaterThanOrEqual(1)
    })

    it('재실행 결과 게이트에서 abort하면 세션이 종료된다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn()
        .mockRejectedValueOnce(new ClarificationNeededError('질문?'))
        .mockResolvedValueOnce({ content: '재실행 결과' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', '답변')
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'abort' }))

      await expect(runP).rejects.toThrow(/aborted/i)
    })

    // ── fail-safe(PR-1): 파싱 불가·미지 응답은 자동 승인하지 않는다(M8 무음 통과 금지·N1 불확실=실패) ──

    it('needs_human: 파싱 불가 응답은 자동 승인하지 않고 사람에게 재검토를 요청한다(에이전트 재실행 X)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      // 파싱 불가 → needs_human → 자동 승인 금지, 같은 산출물로 재요청
      store.resolveInfo('sess-1', '그냥 진행해줘')
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      // 재요청에 정상 승인으로 응답 → 완료
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP

      expect(exec).toHaveBeenCalledTimes(1) // 같은 산출물 재검토 — 에이전트 재실행 없음
      const approvals = mockProducer.publish.mock.calls
        .map((c) => c[0] as { payload?: { approval?: unknown } })
        .filter((m) => m.payload?.approval)
      expect(approvals.length).toBeGreaterThanOrEqual(2) // 최초 + 재요청
    })

    it('needs_human 재요청 카드는 직전 응답을 해석할 수 없다는 사유를 노출한다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', '아무말') // 파싱 불가 → needs_human
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP

      const contents = mockProducer.publish.mock.calls
        .map((c) => c[0] as { payload?: { content?: string; approval?: unknown } })
        .filter((m) => m.payload?.approval)
        .map((m) => m.payload?.content ?? '')
      // 최초 카드는 일반 안내, 재요청 카드(2번째)는 해석 실패 사유를 안내해야 한다(reason 무음 폐기 방지)
      expect(contents.length).toBeGreaterThanOrEqual(2)
      expect(contents.some((c) => c.includes('해석할 수 없'))).toBe(true)
    })

    it('needs_human이 MAX_GATE_REASKS를 초과하면 세션을 중단한다(에스컬레이션)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      // 기본 MAX_GATE_REASKS=3 — 3회까지 재요청, 4번째 파싱 불가 응답에서 에스컬레이션(중단)
      for (let i = 0; i < 3; i++) {
        await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
        store.resolveInfo('sess-1', '모르겠어')
      }
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', '모르겠어') // 4번째 → 에스컬레이션

      await expect(runP).rejects.toThrow(/aborted/i)
      expect(exec).toHaveBeenCalledTimes(1) // 에이전트 재실행 없이 사람 재요청만 반복
      expect(createFn).toHaveBeenCalledTimes(1) // 다음 단계 미실행
    })

    it('revise가 MAX_GATE_REVISES를 초과하면 fail-safe로 세션을 중단한다(무음 통과 금지)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '수정본' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      const revise = JSON.stringify({ decision: 'revise', feedback: '또 고쳐' })
      // 기본 MAX_GATE_REVISES=5 — 5회 재실행 후 6번째 revise에서 소진 → 에스컬레이션(중단)
      for (let i = 0; i < 5; i++) {
        await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
        const before = exec.mock.calls.length
        store.resolveInfo('sess-1', revise)
        await waitFor(() => exec.mock.calls.length === before + 1) // 피드백으로 재실행됨
      }
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', revise) // 6번째 → 소진 → 에스컬레이션

      await expect(runP).rejects.toThrow(/aborted/i)
      expect(exec).toHaveBeenCalledTimes(6) // 최초 1 + 재실행 5(소진 시 재실행 없음)
    })

    it('needs_human이 정확히 MAX_GATE_REASKS회면 에스컬레이션 없이 승인으로 회복한다(경계)', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      // 기본 MAX_GATE_REASKS=3 — 정확히 3회 재요청은 '초과'가 아니므로 에스컬레이션되지 않는다
      for (let i = 0; i < 3; i++) {
        await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
        store.resolveInfo('sess-1', '모르겠음')
      }
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' })) // 4번째 응답은 정상 승인 → 회복
      await runP

      expect(exec).toHaveBeenCalledTimes(1)
    })

    it('needs_human↔revise 인터리브: 두 카운터가 독립이며 happy-path로 종료된다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn()
        .mockResolvedValueOnce({ content: '초안' })
        .mockResolvedValueOnce({ content: '수정본' })
      registerPlan(exec)
      planThenEnd()

      const runP = runner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      // 1) revise → 피드백으로 재실행(exec 2회)
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'revise', feedback: '보강' }))
      await waitFor(() => exec.mock.calls.length === 2)
      // 2) 파싱 불가 → needs_human 재요청(에이전트 재실행 없음)
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', '음...')
      // 3) 재요청에 approve → 완료(revises·reasks 어느 cap도 조기 트립되지 않음)
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify({ decision: 'approve' }))
      await runP

      expect(exec).toHaveBeenCalledTimes(2) // 초기1 + revise재실행1, needs_human은 재실행 없음
    })

    // ── 레거시 fail-open (failSafe=false 주입) — 하위호환 escape hatch 회귀 가드 ──

    it('레거시: 파싱 불가 응답을 needs_human 없이 자동 approve로 통과시킨다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '계획' })
      const legacyRunner = new ClaudeRunner(client, 'claude-test', registry, undefined, false)
      registerPlan(exec)
      planThenEnd()

      const runP = legacyRunner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', '그냥 진행') // 파싱 불가 → 레거시는 자동 approve(fail-open)
      const result = await runP

      expect(result).toBe('done') // 재요청·에스컬레이션 없이 정상 종료
      expect(exec).toHaveBeenCalledTimes(1)
    })

    it('레거시: revise 소진 시 에스컬레이션 없이 마지막 산출물을 반환한다', async () => {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue({ content: '수정본' })
      const legacyRunner = new ClaudeRunner(client, 'claude-test', registry, undefined, false)
      registerPlan(exec)
      planThenEnd()

      const runP = legacyRunner.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore })
      const revise = JSON.stringify({ decision: 'revise', feedback: '또' })
      for (let i = 0; i < 5; i++) {
        await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
        const before = exec.mock.calls.length
        store.resolveInfo('sess-1', revise)
        await waitFor(() => exec.mock.calls.length === before + 1)
      }
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', revise) // 6번째 소진 → 레거시: 마지막 산출물 반환(reject 아님)
      const result = await runP

      expect(result).toBe('done') // 에스컬레이션(abort) 대신 게이트 통과 후 정상 완료
      expect(exec).toHaveBeenCalledTimes(6)
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

    it('result.knowledge 저장 후 knowledge_changed를 발행한다(위키 실시간 갱신)', async () => {
      const repo = makeKnowledgeRepo()
      const store = planAutoSession()
      const exec = vi.fn().mockResolvedValue({ steps: [], estimatedTime: '1h', knowledge: ['결제는 Stripe'] })
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      planThenEndWithCtx()

      const r = new ClaudeRunner(client, 'm', registry, repo as never)
      await r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: userCtx } as Parameters<typeof r.run>[0])

      const events = mockProducer.publish.mock.calls.filter((c) => (c[0] as { type: string }).type === 'knowledge_changed')
      expect(events).toHaveLength(1)
      expect((events[0]?.[0] as { payload: { projectId: string } }).payload.projectId).toBe('proj-1')
    })

    it('저장할 knowledge가 없으면 knowledge_changed를 발행하지 않는다', async () => {
      const repo = makeKnowledgeRepo()
      const store = planAutoSession()
      const exec = vi.fn().mockResolvedValue({ steps: [], estimatedTime: '1h' }) // knowledge 없음
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      planThenEndWithCtx()

      const r = new ClaudeRunner(client, 'm', registry, repo as never)
      await r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: userCtx } as Parameters<typeof r.run>[0])

      const events = mockProducer.publish.mock.calls.filter((c) => (c[0] as { type: string }).type === 'knowledge_changed')
      expect(events).toHaveLength(0)
    })

    it('knowledge가 {content, category} 객체면 category까지 저장한다', async () => {
      const repo = makeKnowledgeRepo()
      const store = planAutoSession()
      const exec = vi.fn().mockResolvedValue({
        steps: [], estimatedTime: '1h',
        knowledge: [{ content: '결제는 Stripe', category: 'decision' }, '미분류 항목'],
      })
      registry.register({ name: 'plan_task', description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      planThenEndWithCtx()

      const r = new ClaudeRunner(client, 'm', registry, repo as never)
      await r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: userCtx } as Parameters<typeof r.run>[0])

      expect(repo.insertMany).toHaveBeenCalledWith('proj-1', [
        { content: '결제는 Stripe', sourceAgent: 'plan_task', category: 'decision' },
        { content: '미분류 항목', sourceAgent: 'plan_task' },
      ])
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

    // 수동 게이트(plan_task)로 승인 후 주어진 answer로 resolveInfo. exec 결과엔 knowledge 없음(게이트 저장만 검증)
    async function runManualGateApprove(
      repo: ReturnType<typeof makeKnowledgeRepo>, stage: string, execResult: unknown, answer: object,
      ctx: Record<string, unknown> = userCtx,
    ): Promise<void> {
      const store = new SessionStore()
      store.create('sess-1')
      const exec = vi.fn().mockResolvedValue(execResult)
      registry.register({ name: stage, description: '', inputSchema: GATED_SCHEMA, execute: exec } as never)
      createFn
        .mockResolvedValueOnce(makeMessage('tool_use', [makeToolUseBlock('t1', stage, { intent: 'x', context: {} })]))
        .mockResolvedValueOnce(makeMessage('end_turn', [makeTextBlock('done')]))
      const r = new ClaudeRunner(client, 'm', registry, repo as never)
      const runP = r.run({ ...baseRunOptions(), sessionStore: store as unknown as SessionStore, userContext: ctx } as Parameters<typeof r.run>[0])
      await waitFor(() => store.get('sess-1')?.state === 'waiting_info')
      store.resolveInfo('sess-1', JSON.stringify(answer))
      await runP
    }

    it('승인 시 saveToWiki=true면 지식성 단계 결정 요약을 위키에 저장한다', async () => {
      const repo = makeKnowledgeRepo()
      await runManualGateApprove(repo, 'plan_task', { content: '결제는 Stripe로 결정', steps: [] }, { decision: 'approve', saveToWiki: true })
      // 승인자(userContext.userId='u1')가 approver로 기록된다(provenance·audit)
      expect(repo.insertMany).toHaveBeenCalledWith('proj-1', [
        { content: '결제는 Stripe로 결정', sourceAgent: 'approval-gate', category: 'decision', approver: 'u1' },
      ])
    })

    it('승인 시 saveToWiki 없으면 게이트 결정을 저장하지 않는다', async () => {
      const repo = makeKnowledgeRepo()
      await runManualGateApprove(repo, 'plan_task', { content: '계획', steps: [] }, { decision: 'approve' })
      expect(repo.insertMany).not.toHaveBeenCalled()
    })

    it('비지식성 단계(run_tests)는 saveToWiki=true여도 저장하지 않는다', async () => {
      const repo = makeKnowledgeRepo()
      await runManualGateApprove(repo, 'run_tests', { content: '테스트 통과' }, { decision: 'approve', saveToWiki: true })
      expect(repo.insertMany).not.toHaveBeenCalled()
    })

    it('projectId 없으면 saveToWiki=true여도 저장하지 않는다', async () => {
      const repo = makeKnowledgeRepo()
      await runManualGateApprove(
        repo, 'plan_task', { content: '계획', steps: [] }, { decision: 'approve', saveToWiki: true },
        { userId: 'u1', workspaceRoot: '/ws' }, // projectId 없음
      )
      expect(repo.insertMany).not.toHaveBeenCalled()
    })

    it('게이트 저장 실패는 승인 흐름을 차단하지 않는다', async () => {
      const repo = makeKnowledgeRepo()
      repo.insertMany.mockRejectedValue(new Error('db down'))
      await expect(
        runManualGateApprove(repo, 'plan_task', { content: '계획', steps: [] }, { decision: 'approve', saveToWiki: true }),
      ).resolves.toBeUndefined()
      expect(repo.insertMany).toHaveBeenCalled()
    })

    it('승인 시 PO가 편집한 wikiSummary가 있으면 자동 요약 대신 그 내용을 저장한다', async () => {
      const repo = makeKnowledgeRepo()
      await runManualGateApprove(
        repo, 'plan_task', { content: '원본 자동 요약' },
        { decision: 'approve', saveToWiki: true, wikiSummary: 'PO가 편집한 결정 요약' },
      )
      expect(repo.insertMany).toHaveBeenCalledWith('proj-1', [
        { content: 'PO가 편집한 결정 요약', sourceAgent: 'approval-gate', category: 'decision', approver: 'u1' },
      ])
    })

    it('승인 결정 저장(saveToWiki) 후 knowledge_changed를 발행한다(위키 실시간 갱신)', async () => {
      const repo = makeKnowledgeRepo()
      await runManualGateApprove(repo, 'plan_task', { content: '결정' }, { decision: 'approve', saveToWiki: true })
      const events = mockProducer.publish.mock.calls.filter((c) => (c[0] as { type: string }).type === 'knowledge_changed')
      expect(events).toHaveLength(1)
      expect((events[0]?.[0] as { payload: { projectId: string } }).payload.projectId).toBe('proj-1')
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
