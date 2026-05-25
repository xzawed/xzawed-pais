import { vi, describe, it, expect } from 'vitest'

vi.mock('@anthropic-ai/sdk')

import { ClaudeRunner } from './runner.js'
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

describe('ClaudeRunner', () => {
  it('빌드 로그에서 BuildError 배열을 반환한다', async () => {
    const mockClient = makeClient(
      '[{"file":"src/index.ts","line":10,"message":"Type error","suggestion":"타입을 명시하세요"}]'
    )
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('error TS2345: ...')

    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('src/index.ts')
    expect(errors[0].line).toBe(10)
    expect(errors[0].message).toBe('Type error')
    expect(errors[0].suggestion).toBe('타입을 명시하세요')
  })

  it('SDK 오류 시 fallback BuildError를 반환한다', async () => {
    const mockClient = { messages: { create: vi.fn().mockRejectedValue(new Error('API error')) } }
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('build failed')

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('build failed')
    expect(errors[0].suggestion).toContain('Claude 분석 실패')
  })

  it('JSON이 없는 응답에서 fallback을 반환한다', async () => {
    const mockClient = makeClient('분석할 수 없는 응답입니다.')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('build output')

    expect(errors).toHaveLength(1)
    expect(errors[0].suggestion).toContain('Claude 분석 실패')
  })

  it('JSON은 있지만 Zod 스키마 검증 실패 시 fallback을 반환한다', async () => {
    // suggestion 필드 누락 → BuildErrorSchema 검증 실패 → fallback
    const mockClient = makeClient('[{"file":"src/a.ts","message":"오류","notSuggestion":"잘못된 필드"}]')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('build failed')

    expect(errors).toHaveLength(1)
    expect(errors[0].suggestion).toContain('Claude 분석 실패')
  })
})
