import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Message } from '@xzawed/shared'
import { HTTPRemoteRunner } from './http-remote-runner.js'

function makeNdjsonStream(chunks: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
      }
      controller.close()
    },
  })
}

const MSG: Message = { id: '1', sessionId: 's', role: 'user', content: 'hello', timestamp: 0 }

describe('HTTPRemoteRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('yields chunks from NDJSON streaming response', async () => {
    const mockChunks = [
      { type: 'text', content: 'Hello' },
      { type: 'done', content: '' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeNdjsonStream(mockChunks),
    }))

    const runner = new HTTPRemoteRunner('http://remote:4000')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results).toEqual(mockChunks)
  })

  it('yields error on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    }))

    const runner = new HTTPRemoteRunner('http://remote:4000')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: 'Remote server returned 503' })
  })

  it('yields error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const runner = new HTTPRemoteRunner('http://remote:4000')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: 'ECONNREFUSED' })
  })

  it('yields error on abort', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const runner = new HTTPRemoteRunner('http://remote:4000')
    const results: object[] = []
    const controller = new AbortController()
    controller.abort()
    for await (const chunk of runner.send([MSG], { signal: controller.signal })) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: 'Request aborted' })
  })
})
