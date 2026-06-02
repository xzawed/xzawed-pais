import { describe, it, expect, vi, afterEach } from 'vitest'
import { postUiAction, getKnowledge } from '../../src/renderer/src/lib/api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('postUiAction', () => {
  it('POSTs the action to /sessions/:id/ui-actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await postUiAction('http://localhost:3000', 'sess-1', '{"decision":"approve"}')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/sess-1/ui-actions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: '{"decision":"approve"}' }),
      }),
    )
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response))
    await expect(postUiAction('http://localhost:3000', 'sess-1', 'x')).rejects.toThrow(/500/)
  })

  it('rejects a non-http base url before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(postUiAction('ftp://evil', 'sess-1', 'x')).rejects.toThrow(/http or https/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getKnowledge', () => {
  it('items 배열을 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [{ content: 'a', sourceAgent: 'planner', createdAt: 't' }] }),
    }))
    expect(await getKnowledge('http://localhost:3000', 'p1')).toEqual([
      { content: 'a', sourceAgent: 'planner', createdAt: 't' },
    ])
  })

  it('non-ok 응답이면 빈 배열', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await getKnowledge('http://localhost:3000', 'p1')).toEqual([])
  })

  it('items가 배열이 아니면 빈 배열', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }))
    expect(await getKnowledge('http://localhost:3000', 'p1')).toEqual([])
  })

  it('query가 있으면 q 파라미터를 붙인다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await getKnowledge('http://localhost:3000', 'p1', 'stripe')
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    expect(calledUrl.searchParams.get('q')).toBe('stripe')
  })
})
