function validateBaseUrl(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Server URL must use http or https scheme: ${url}`)
  }
}

export type WsMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'chunk'; messageId: string; content: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; content: string }
  | { type: 'status'; content: string }
  | { type: 'agent_status'; agentId: string; content: string }
  | { type: 'agent_done'; agentId: string; content: string }
  | { type: 'agent_error'; agentId: string; content: string }
  | { type: 'agent_info_request'; agentId: string; content: string; uiSpec?: unknown }

export interface CreateSessionResponse {
  sessionId: string
}

export interface PostMessageResponse {
  messageId: string
  status: 'accepted'
}

export async function createSession(baseUrl: string, userId: string): Promise<CreateSessionResponse> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`)
  return res.json() as Promise<CreateSessionResponse>
}

export async function postMessage(
  baseUrl: string,
  sessionId: string,
  content: string
): Promise<PostMessageResponse> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`)
  return res.json() as Promise<PostMessageResponse>
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    validateBaseUrl(baseUrl)
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

export class SessionWsClient {
  private ws: WebSocket | null = null

  connect(
    baseUrl: string,
    sessionId: string,
    onMessage: (msg: WsMessage) => void,
    onClose?: () => void
  ): () => void {
    validateBaseUrl(baseUrl)
    const base = new URL(baseUrl)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = `/ws/sessions/${sessionId}`
    base.search = ''
    base.hash = ''
    const wsUrl = base.toString()
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {}

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage
        onMessage(msg)
      } catch {
        // ignore non-JSON frames
      }
    }

    this.ws.onerror = (e) => {
      console.error('[WS] Error:', e)
      onMessage({ type: 'error', content: 'WebSocket connection error' })
      onClose?.()
    }

    this.ws.onclose = () => {
      onClose?.()
    }

    return () => {
      this.ws?.close()
      this.ws = null
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
