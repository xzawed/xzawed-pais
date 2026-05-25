import { describe, it, expect, vi } from 'vitest'
import type { Message } from '@xzawed/shared'

const mockStream = vi.fn().mockReturnValue({
  async *[Symbol.asyncIterator]() {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }
    yield { type: 'message_stop' }
  }
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: mockStream }
  }
}))

describe('APIRunner', () => {
  it('streams text chunks from Anthropic API', async () => {
    const { APIRunner } = await import('../../src/claude/api-runner.js')
    const runner = new APIRunner({ apiKey: 'test-key', model: 'claude-sonnet-4-6' })

    const messages: Message[] = [{
      id: '1', sessionId: 's1', role: 'user',
      content: 'Hello', timestamp: Date.now()
    }]

    const chunks: string[] = []
    for await (const chunk of runner.send(messages)) {
      if (chunk.type === 'text') chunks.push(chunk.content)
    }

    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('yields error chunk on API failure', async () => {
    mockStream.mockReturnValueOnce({
      [Symbol.asyncIterator](): AsyncIterator<never> {
        return {
          next(): Promise<IteratorResult<never>> {
            return Promise.reject(new Error('Unauthorized'))
          }
        }
      }
    })

    const { APIRunner } = await import('../../src/claude/api-runner.js')
    const runner = new APIRunner({ apiKey: 'bad-key', model: 'claude-sonnet-4-6' })

    const chunks: import('@xzawed/shared').Chunk[] = []
    for await (const chunk of runner.send([])) {
      chunks.push(chunk)
    }

    expect(chunks[0]).toMatchObject({ type: 'error', content: expect.stringContaining('Unauthorized') })
  })
})
