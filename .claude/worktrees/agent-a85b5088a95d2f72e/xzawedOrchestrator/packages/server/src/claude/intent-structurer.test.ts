import { describe, it, expect, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { structureIntent } from './intent-structurer.js'

vi.mock('@anthropic-ai/sdk')

function makeClient(text: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
      }),
    },
  } as unknown as Anthropic
}

describe('structureIntent', () => {
  it('returns extracted intent from Claude response', async () => {
    const client = makeClient('쇼핑몰 상품 목록 REST API를 구현하세요.')
    const result = await structureIntent('안녕하세요! 쇼핑몰 API...', client, 'claude-sonnet-4-6')
    expect(result).toBe('쇼핑몰 상품 목록 REST API를 구현하세요.')
  })

  it('falls back to raw response on API failure', async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error('API error')) },
    } as unknown as Anthropic
    const raw = 'raw claude response content'
    const result = await structureIntent(raw, client, 'claude-sonnet-4-6')
    expect(result).toBe(raw)
  })

  it('falls back to raw response when content text is blank', async () => {
    const client = makeClient('   ')
    const raw = 'raw claude response content'
    const result = await structureIntent(raw, client, 'claude-sonnet-4-6')
    expect(result).toBe(raw)
  })

  it('falls back to raw response when content block is not text type', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }],
        }),
      },
    } as unknown as Anthropic
    const raw = 'raw response'
    const result = await structureIntent(raw, client, 'claude-sonnet-4-6')
    expect(result).toBe(raw)
  })
})
