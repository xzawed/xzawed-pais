import { vi, describe, it, expect } from 'vitest'

vi.mock('@anthropic-ai/sdk')

import { ClaudeRunner, ClarificationNeeded } from './runner.js'
import { AgentQuery } from '@xzawed/agent-streams'
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
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('로그인 페이지 만들기', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0].id).toBe('step-1')
      expect(result.steps[1].agentType).toBe('designer')
      expect(result.estimatedTime).toBe('50 minutes')
    }
  })

  it('응답의 knowledge 배열을 도메인 지식으로 반환한다', async () => {
    const withKnowledge = JSON.stringify({
      steps: [{
        id: 'step-1', title: '결제 연동', description: 'Stripe 결제',
        agentType: 'developer', dependencies: [], estimatedMinutes: 30,
      }],
      estimatedTime: '30 minutes',
      knowledge: ['결제는 Stripe 사용', 'PII는 암호화 저장'],
    })
    const mockClient = makeClient(withKnowledge)
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('결제 기능', {}, 'normal')

    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.knowledge).toEqual(['결제는 Stripe 사용', 'PII는 암호화 저장'])
    }
  })

  it('knowledge가 {content, category} 객체 배열이면 그대로 반환한다', async () => {
    const withCategorized = JSON.stringify({
      steps: [{
        id: 'step-1', title: '결제 연동', description: 'Stripe 결제',
        agentType: 'developer', dependencies: [], estimatedMinutes: 30,
      }],
      estimatedTime: '30 minutes',
      knowledge: [{ content: '결제는 Stripe 사용', category: 'decision' }],
    })
    const mockClient = makeClient(withCategorized)
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('결제', {}, 'normal')

    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.knowledge).toEqual([{ content: '결제는 Stripe 사용', category: 'decision' }])
    }
  })

  it('knowledge가 없으면 결과에 knowledge 키가 없다', async () => {
    const mockClient = makeClient(stepsResponse)
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('로그인', {}, 'normal')

    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.knowledge).toBeUndefined()
    }
  })

  it('주입된 domainKnowledge를 LLM 프롬프트에 포함한다', async () => {
    const mockClient = makeClient(stepsResponse)
    AnthropicMock.mockImplementation(function () { return mockClient as any })
    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    await runner.generatePlan('intent', {
      domainKnowledge: [{ content: '결제는 Stripe 사용', sourceAgent: 'plan_task' }],
    }, 'normal')
    const content = mockClient.messages.create.mock.calls[0][0].messages[0].content as string
    expect(content).toContain('이전 프로젝트 도메인 지식')
    expect(content).toContain('결제는 Stripe 사용')
  })

  it('clarification_needed 응답에서 ClarificationNeeded를 반환한다', async () => {
    const mockClient = makeClient(clarificationResponse)
    AnthropicMock.mockImplementation(function () { return mockClient as any })

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
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    await expect(runner.generatePlan('인증 미들웨어 추가', {}, 'normal')).rejects.toThrow('API error')
  })

  it('JSON이 없는 응답에서 fallback Step을 반환한다', async () => {
    const mockClient = makeClient('계획을 세울 수 없습니다.')
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('API 서버 구축', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.steps).toHaveLength(1)
      expect(result.estimatedTime).toBe('1 hour')
    }
  })

  it('빈 steps 배열 응답에서 fallback을 반환한다', async () => {
    const mockClient = makeClient(JSON.stringify({ steps: [], estimatedTime: '0 minutes' }))
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.steps).toHaveLength(1)
    }
  })

  it('JSON.parse 실패 시 fallback Step을 반환한다', async () => {
    // Has { and } but invalid JSON — triggers the catch block (lines 104-105)
    const mockClient = makeClient('{invalid json here}')
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
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
    AnthropicMock.mockImplementation(function () { return mockClient as any })

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
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan(longIntent, {}, 'normal')

    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.steps[0].title.length).toBeLessThanOrEqual(60)
    }
  })

  it('JSON.parse가 null을 반환하면 fallback Step을 반환한다', async () => {
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(function () { return null })
    const mockClient = makeClient('{"placeholder": true}')
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    spy.mockRestore()
    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.steps).toHaveLength(1)
      expect(result.estimatedTime).toBe('1 hour')
    }
  })

  it('clarification_needed question이 없으면 기본 질문을 사용한다', async () => {
    const mockClient = makeClient(JSON.stringify({
      clarification_needed: true,
      fields: [{ id: 'f1', label: 'Label', type: 'text' }],
    }))
    AnthropicMock.mockImplementation(function () { return mockClient as any })

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
    AnthropicMock.mockImplementation(function () { return mockClient as any })

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const result = await runner.generatePlan('테스트', {}, 'normal')

    expect(result).not.toBeInstanceOf(ClarificationNeeded)
    if (!(result instanceof ClarificationNeeded) && !(result instanceof AgentQuery)) {
      expect(result.estimatedTime).toBe('1 hour')
    }
  })

  it('agent_query 응답에서 AgentQuery를 반환한다', async () => {
    const mockClient = makeClient('{"agent_query":true,"to":"developer","question":"가능?","kind":"active_request"}')
    AnthropicMock.mockImplementation(function () { return mockClient as any })
    const runner = new ClaudeRunner('sk-ant-test', 'claude-test')
    const result = await runner.generatePlan('intent', {}, 'normal')
    expect(result).toBeInstanceOf(AgentQuery)
  })

  it('answerQuery는 Claude 텍스트 답변을 반환한다', async () => {
    const mockClient = makeClient('기획 관점 답변')
    AnthropicMock.mockImplementation(function () { return mockClient as any })
    const runner = new ClaudeRunner('sk-ant-test', 'claude-test')
    expect(await runner.answerQuery('q', {})).toBe('기획 관점 답변')
  })
})
