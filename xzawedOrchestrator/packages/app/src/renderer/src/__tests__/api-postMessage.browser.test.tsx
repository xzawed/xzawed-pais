import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { postMessage } from '../lib/api.js'

describe('postMessage — mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ messageId: 'm', status: 'accepted' }) }))
  })
  afterEach(() => vi.unstubAllGlobals())

  test("mode='build'이면 body에 mode:'build' 포함", async () => {
    await postMessage('http://localhost:3000', 's1', 'hi', undefined, undefined, 'build')
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string)
    expect(body.mode).toBe('build')
    expect(body.content).toBe('hi')
  })

  test("mode 미지정/'chat'이면 body에 mode 키 부재", async () => {
    await postMessage('http://localhost:3000', 's1', 'hi')
    let body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string)
    expect('mode' in body).toBe(false)
    await postMessage('http://localhost:3000', 's1', 'hi', undefined, undefined, 'chat')
    body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[1]![1].body as string)
    expect('mode' in body).toBe(false)
  })
})
