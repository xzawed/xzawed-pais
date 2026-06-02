import { describe, it, expect, vi, afterEach } from 'vitest'
import { postUiAction, getKnowledge, updateKnowledge, deleteKnowledge } from '../../src/renderer/src/lib/api.js'

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
      json: () => Promise.resolve({ items: [{ id: 1, content: 'a', sourceAgent: 'planner', createdAt: 't' }] }),
    }))
    expect(await getKnowledge('http://localhost:3000', 'p1')).toEqual([
      { id: 1, content: 'a', sourceAgent: 'planner', createdAt: 't' },
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

  it('source가 있으면 source 파라미터를 붙인다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await getKnowledge('http://localhost:3000', 'p1', undefined, 'plan_task')
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    expect(calledUrl.searchParams.get('source')).toBe('plan_task')
  })

  it('category가 있으면 category 파라미터를 붙인다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await getKnowledge('http://localhost:3000', 'p1', undefined, undefined, 'decision')
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    expect(calledUrl.searchParams.get('category')).toBe('decision')
  })
})

describe('updateKnowledge', () => {
  it('PATCH로 content와 category를 전송한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await updateKnowledge('http://localhost:3000', 'p1', 42, '수정된 내용', 'decision')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/projects/p1/knowledge/42',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '수정된 내용', category: 'decision' }),
      }),
    )
  })

  it('category가 null이면 null로 전송한다(분류 해제)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await updateKnowledge('http://localhost:3000', 'p1', 7, 'x', null)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/projects/p1/knowledge/7',
      expect.objectContaining({ body: JSON.stringify({ content: 'x', category: null }) }),
    )
  })

  it('non-ok 응답이면 throw한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response))
    await expect(updateKnowledge('http://localhost:3000', 'p1', 1, 'x', null)).rejects.toThrow(/404/)
  })

  it('non-http base url은 fetch 전에 거부한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(updateKnowledge('ftp://evil', 'p1', 1, 'x', null)).rejects.toThrow(/http or https/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deleteKnowledge', () => {
  it('DELETE 메서드로 항목을 삭제한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await deleteKnowledge('http://localhost:3000', 'p1', 99)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/projects/p1/knowledge/99',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('non-ok 응답이면 throw한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response))
    await expect(deleteKnowledge('http://localhost:3000', 'p1', 1)).rejects.toThrow(/503/)
  })

  it('non-http base url은 fetch 전에 거부한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(deleteKnowledge('ftp://evil', 'p1', 1)).rejects.toThrow(/http or https/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
