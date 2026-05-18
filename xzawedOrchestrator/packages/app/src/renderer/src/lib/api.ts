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
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws/sessions/${sessionId}`
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
