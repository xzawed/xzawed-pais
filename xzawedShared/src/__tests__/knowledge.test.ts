import { describe, it, expect, vi } from 'vitest'
import { parseKnowledgeArray, extractKnowledgeViaClaude } from '../claude/knowledge.js'
import type { ClaudeLike } from '../claude/answer-query.js'

describe('parseKnowledgeArray', () => {
  it('객체 형식 {knowledge}에서 문자열 배열을 추출한다', () => {
    const input = JSON.stringify({ knowledge: ['테스트는 Vitest 사용', '커버리지 80% 게이트'] })
    expect(parseKnowledgeArray(input)).toEqual(['테스트는 Vitest 사용', '커버리지 80% 게이트'])
  })

  it('코드 펜스를 제거하고 파싱한다', () => {
    const input = '```json\n{"knowledge":["프로세스 격리(pool:forks)"]}\n```'
    expect(parseKnowledgeArray(input)).toEqual(['프로세스 격리(pool:forks)'])
  })

  it('knowledge가 없거나 빈 배열이면 []를 반환한다', () => {
    expect(parseKnowledgeArray('{}')).toEqual([])
    expect(parseKnowledgeArray('{"knowledge":[]}')).toEqual([])
  })

  it('knowledge가 배열이 아니면 []를 반환한다', () => {
    expect(parseKnowledgeArray('{"knowledge":"문자열"}')).toEqual([])
  })

  it('문자열이 아닌 항목은 걸러낸다', () => {
    const input = JSON.stringify({ knowledge: ['유효', 42, { a: 1 }, null] })
    expect(parseKnowledgeArray(input)).toEqual(['유효'])
  })

  it('객체가 아닌 JSON(배열·null)이면 []를 반환한다', () => {
    expect(parseKnowledgeArray('[1,2,3]')).toEqual([])
    expect(parseKnowledgeArray('null')).toEqual([])
  })

  it('잘못된 JSON·빈 문자열이면 []를 반환한다', () => {
    expect(parseKnowledgeArray('not json')).toEqual([])
    expect(parseKnowledgeArray('')).toEqual([])
    expect(parseKnowledgeArray('{ unbalanced')).toEqual([])
  })
})

describe('extractKnowledgeViaClaude', () => {
  it('Claude가 반환한 durable 지식을 파싱한다', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ knowledge: ['빌드는 Turborepo로 오케스트레이션'] }) }],
    })
    const client: ClaudeLike = { messages: { create } }

    const result = await extractKnowledgeViaClaude(client, 'claude-test', 'PROMPT', 'build log', 1000)

    expect(result).toEqual(['빌드는 Turborepo로 오케스트레이션'])
    expect(create).toHaveBeenCalledWith({
      model: 'claude-test',
      max_tokens: 1024,
      system: 'PROMPT',
      messages: [{ role: 'user', content: 'build log' }],
    })
  })

  it('8000자를 초과한 출력은 잘라서 전달한다', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"knowledge":[]}' }] })
    const client: ClaudeLike = { messages: { create } }

    await extractKnowledgeViaClaude(client, 'm', 'p', 'x'.repeat(9000), 1000)

    const sentContent = create.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(sentContent).toHaveLength(8000)
  })

  it('SDK가 throw하면 []를 반환한다', async () => {
    const create = vi.fn().mockRejectedValue(new Error('timeout'))
    const client: ClaudeLike = { messages: { create } }
    expect(await extractKnowledgeViaClaude(client, 'm', 'p', 'output', 1000)).toEqual([])
  })
})
