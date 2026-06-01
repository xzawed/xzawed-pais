import { describe, it, expect, vi } from 'vitest'
import { answerViaClaude, stripJsonFences, extractClaudeText } from '../claude/answer-query.js'

describe('stripJsonFences', () => {
  it('```json 펜스를 제거한다', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('``` 펜스를 제거한다', () => {
    expect(stripJsonFences('```\n[1,2]\n```')).toBe('[1,2]')
  })
  it('개행 없는 펜스도 처리한다', () => {
    expect(stripJsonFences('```{"a":1}```')).toBe('{"a":1}')
  })
  it('펜스가 없으면 trim만 한다', () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe('extractClaudeText', () => {
  it('text 블록만 모은다', () => {
    expect(extractClaudeText([{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }])).toBe('ab')
  })
})

describe('answerViaClaude', () => {
  it('system 프롬프트와 질의를 Claude에 전달하고 텍스트를 합쳐 반환한다', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: '가능합니다. ' },
        { type: 'text', text: '5초 폴링을 권장합니다.' },
      ],
    })
    const client = { messages: { create } }

    const answer = await answerViaClaude(
      client, 'claude-test', 'You are an expert.', '재고 표시 가능?', { framework: 'react' },
    )

    expect(answer).toBe('가능합니다. 5초 폴링을 권장합니다.')
    expect(create).toHaveBeenCalledWith({
      model: 'claude-test',
      max_tokens: 1024,
      system: 'You are an expert.',
      messages: [{
        role: 'user',
        content: 'Question: 재고 표시 가능?\n\nContext: {\n  "framework": "react"\n}',
      }],
    })
  })

  it('text가 아닌 블록은 무시한다', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'tool_use' },
        { type: 'text', text: '답변' },
      ],
    })
    const answer = await answerViaClaude({ messages: { create } }, 'm', 's', 'q', {})
    expect(answer).toBe('답변')
  })
})
