import { vi, describe, it, expect } from 'vitest'

vi.mock('@anthropic-ai/sdk')

import { ClaudeRunner, ClarificationNeeded } from './runner.js'
import Anthropic from '@anthropic-ai/sdk'

const AnthropicMock = vi.mocked(Anthropic)

function makeClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

const stepsResponse = JSON.stringify({
  steps: [
    {
      id: 'step-1',
      title: '로그인 컴포넌트 생성',
      description: 'React 로그인 폼 컴포넌트를 작성한다',
      agentType: 'developer',
      dependencies: [],
      estimatedMinutes: 30,
    },
    {
      id: 'step-2',
      title: 'UI 디자인',
      description: '로그인 폼 디자인 스펙',
      agentType: 'designer',
      dependencies: ['step-1'],
      estimatedMinutes: 20,
    },
  ],
  estimatedTime: '50 minutes',
})

const clarificationResponse = JSON.stringify({
  clarification_needed: true,
  question: '어떤 프레임워크를 사용할까요?',
  fields: [
    { id: 'framework', label: '프레임워크', type: 'select', options: ['React', 'Vue'], required: true },
  ],
})

describe('ClaudeRunner', () => {
  it('정상 응답에서 Step[] 배열을 반환한다', async () => {
    const mockClient = makeClient(stepsResponse)
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('로그인 페이지 만들기', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded)) {
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0].id).toBe('step-1')
      expect(result.steps[1].agentType).toBe('designer')
      expect(result.estimatedTime).toBe('50 minutes')
    }
  })

  it('clarification_needed 응답에서 ClarificationNeeded를 반환한다', async () => {
    const mockClient = makeClient(clarificationResponse)
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('앱 만들기', {}, 'high')

    expect(result).toBeInstanceOf(ClarificationNeeded)
    if (result instanceof ClarificationNeeded) {
      expect(result.question).toBe('어떤 프레임워크를 사용할까요?')
      expect(result.fields).toHaveLength(1)
      expect(result.fields[0].id).toBe('framework')
    }
  })

  it('SDK 오류 시 에러를 던진다 (API 오류는 fallback 없이 전파)', async () => {
    const mockClient = { messages: { create: vi.fn().mockRejectedValue(new Error('API error')) } }
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    await expect(runner.generatePlan('인증 미들웨어 추가', {}, 'normal')).rejects.toThrow('API error')
  })

  it('JSON이 없는 응답에서 fallback Step을 반환한다', async () => {
    const mockClient = makeClient('계획을 세울 수 없습니다.')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('API 서버 구축', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded)) {
      expect(result.steps).toHaveLength(1)
      expect(result.estimatedTime).toBe('1 hour')
    }
  })

  it('빈 steps 배열 응답에서 fallback을 반환한다', async () => {
    const mockClient = makeClient(JSON.stringify({ steps: [], estimatedTime: '0 minutes' }))
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded)) {
      expect(result.steps).toHaveLength(1)
    }
  })

  it('JSON.parse 실패 시 fallback Step을 반환한다', async () => {
    // Has { and } but invalid JSON — triggers the catch block (lines 104-105)
    const mockClient = makeClient('{invalid json here}')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded)) {
      expect(result.steps).toHaveLength(1)
      expect(result.estimatedTime).toBe('1 hour')
    }
  })

  it('clarification_needed fields가 유효하지 않으면 빈 배열로 처리한다', async () => {
    // fields is not an array — fieldsResult.success = false → validatedFields = [] (line 123)
    const mockClient = makeClient(JSON.stringify({
      clarification_needed: true,
      question: '어떤 것이 필요하신가요?',
      fields: 'not-an-array',
    }))
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('앱 만들기', {}, 'normal')

    expect(result).toBeInstanceOf(ClarificationNeeded)
    if (result instanceof ClarificationNeeded) {
      expect(result.question).toBe('어떤 것이 필요하신가요?')
      expect(result.fields).toEqual([])
    }
  })

  it('JSON이 없는 응답에서 fallback 제목은 60자를 초과하지 않는다', async () => {
    const longIntent = 'A'.repeat(80)
    const mockClient = makeClient('계획을 세울 수 없습니다.')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan(longIntent, {}, 'normal')

    if (!(result instanceof ClarificationNeeded)) {
      expect(result.steps[0].title.length).toBeLessThanOrEqual(60)
    }
  })

  it('JSON.parse가 null을 반환하면 fallback Step을 반환한다', async () => {
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => null)
    const mockClient = makeClient('{"placeholder": true}')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    spy.mockRestore()
    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded)) {
      expect(result.steps).toHaveLength(1)
      expect(result.estimatedTime).toBe('1 hour')
    }
  })

  it('clarification_needed question이 없으면 기본 질문을 사용한다', async () => {
    const mockClient = makeClient(JSON.stringify({
      clarification_needed: true,
      fields: [{ id: 'f1', label: 'Label', type: 'text' }],
    }))
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('앱 만들기', {}, 'normal')

    expect(result).toBeInstanceOf(ClarificationNeeded)
    if (result instanceof ClarificationNeeded) {
      expect(result.question).toBe('Could you provide more details?')
    }
  })

  it('estimatedTime이 없는 응답에서 기본값 "1 hour"를 사용한다', async () => {
    const mockClient = makeClient(JSON.stringify({
      steps: [{
        id: 'step-1',
        title: '단계',
        description: '설명',
        agentType: 'developer',
        dependencies: [],
        estimatedMinutes: 30,
      }],
    }))
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded)) {
      expect(result.estimatedTime).toBe('1 hour')
    }
  })
})
