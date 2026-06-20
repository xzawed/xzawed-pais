import { describe, it, expect, vi, afterEach } from 'vitest'
import { getPendingDecisions, submitDecision } from '../lib/api.js'

afterEach(() => vi.restoreAllMocks())

describe('getPendingDecisions', () => {
  it('Manager 프록시 응답의 items를 반환', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ items: [{ requestId: 'r1', type: 'defect_brief' }] }),
    } as Response))
    const items = await getPendingDecisions('http://x', 'p1')
    expect(items).toEqual([{ requestId: 'r1', type: 'defect_brief' }])
  })
  it('non-ok면 빈 배열', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    expect(await getPendingDecisions('http://x', 'p1')).toEqual([])
  })
})

describe('submitDecision', () => {
  it('choice·justification을 POST하고 토큰을 Authorization으로 전달', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await submitDecision('http://x', 'p1', 'r1', 'fix_reverify', '재시도', 'tok-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/projects/p1/decisions/r1/decision')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ choice: 'fix_reverify', justification: '재시도' })
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-1')
  })
  it('non-ok면 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 } as Response))
    await expect(submitDecision('http://x', 'p1', 'r1', 'fix_reverify')).rejects.toThrow()
  })
})
