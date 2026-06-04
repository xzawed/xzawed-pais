import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { postMessage, postUiAction, getKnowledge, getDeletedKnowledge, updateKnowledge, deleteKnowledge, restoreKnowledge, SessionWsClient } from '../../src/renderer/src/lib/api.js'

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

describe('postMessage', () => {
  it('gateMode가 있으면 body에 포함한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ messageId: 'm', status: 'accepted' }) })
    vi.stubGlobal('fetch', fetchMock)
    await postMessage('http://localhost:3000', 'sess-1', '안녕', 'auto')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/sess-1/messages',
      expect.objectContaining({ body: JSON.stringify({ content: '안녕', gateMode: 'auto' }) }),
    )
  })

  it('gateMode가 없으면 content만 보낸다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ messageId: 'm', status: 'accepted' }) })
    vi.stubGlobal('fetch', fetchMock)
    await postMessage('http://localhost:3000', 'sess-1', '안녕')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/sess-1/messages',
      expect.objectContaining({ body: JSON.stringify({ content: '안녕' }) }),
    )
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

  it('accessToken이 있으면 Authorization 헤더를 첨부한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await updateKnowledge('http://localhost:3000', 'p1', 42, 'x', null, 'tok-123')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/projects/p1/knowledge/42',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-123' },
      }),
    )
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

  it('accessToken이 있으면 Authorization 헤더를 첨부한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await deleteKnowledge('http://localhost:3000', 'p1', 99, 'tok-123')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/projects/p1/knowledge/99',
      expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer tok-123' } }),
    )
  })
})

describe('getDeletedKnowledge', () => {
  it('?deleted=true로 휴지통 항목을 조회한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [{ id: 3, content: 'x', sourceAgent: 'planner', createdAt: 't' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await getDeletedKnowledge('http://localhost:3000', 'p1')
    const calledUrl = fetchMock.mock.calls[0][0] as URL
    expect(calledUrl.searchParams.get('deleted')).toBe('true')
    expect(out).toHaveLength(1)
  })

  it('non-ok면 빈 배열', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await getDeletedKnowledge('http://localhost:3000', 'p1')).toEqual([])
  })
})

describe('restoreKnowledge', () => {
  it('POST /:id/restore로 복구하고 accessToken을 Authorization으로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await restoreKnowledge('http://localhost:3000', 'p1', 5, 'tok-123')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/projects/p1/knowledge/5/restore',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok-123' } }),
    )
  })

  it('non-ok면 throw한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response))
    await expect(restoreKnowledge('http://localhost:3000', 'p1', 1)).rejects.toThrow(/404/)
  })
})

describe('SessionWsClient', () => {
  const wsInstances: MockWebSocket[] = []
  class MockWebSocket {
    static readonly OPEN = 1
    readyState = 1
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    onclose: (() => void) | null = null
    sent: string[] = []
    closed = false
    constructor(
      public url: string,
      public protocols?: string | string[],
    ) {
      wsInstances.push(this)
    }
    send(d: string): void {
      this.sent.push(d)
    }
    close(): void {
      this.closed = true
      this.onclose?.()
    }
  }

  beforeEach(() => {
    wsInstances.length = 0
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  it('토큰이 있으면 bearer.<token> 서브프로토콜로 연결한다', () => {
    new SessionWsClient().connect('http://localhost:3000', 'sess-1', vi.fn(), vi.fn(), 'tok-9', vi.fn())
    expect(wsInstances[0]?.url).toBe('ws://localhost:3000/ws/sessions/sess-1')
    expect(wsInstances[0]?.protocols).toEqual(['bearer.tok-9'])
  })

  it('토큰이 없으면 서브프로토콜 없이 연결한다', () => {
    new SessionWsClient().connect('http://localhost:3000', 'sess-1', vi.fn())
    expect(wsInstances[0]?.protocols).toBeUndefined()
  })

  it('연결 성공 시 onOpen을 호출한다(백오프 리셋용)', () => {
    const onOpen = vi.fn()
    new SessionWsClient().connect('http://localhost:3000', 'sess-1', vi.fn(), vi.fn(), null, onOpen)
    wsInstances[0]?.onopen?.()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('전송 오류 시 onClose만 호출하고 채팅 에러 메시지를 주입하지 않는다(재연결 스팸 방지)', () => {
    const onMessage = vi.fn()
    const onClose = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    new SessionWsClient().connect('http://localhost:3000', 'sess-1', onMessage, onClose)
    wsInstances[0]?.onerror?.(new Event('error'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('수신 JSON 프레임을 파싱해 onMessage로 전달한다', () => {
    const onMessage = vi.fn()
    new SessionWsClient().connect('http://localhost:3000', 'sess-1', onMessage)
    wsInstances[0]?.onmessage?.({ data: JSON.stringify({ type: 'status', content: 'hi' }) })
    expect(onMessage).toHaveBeenCalledWith({ type: 'status', content: 'hi' })
  })

  it('teardown 호출 시 소켓을 닫는다', () => {
    const teardown = new SessionWsClient().connect('http://localhost:3000', 'sess-1', vi.fn())
    teardown()
    expect(wsInstances[0]?.closed).toBe(true)
  })
})
