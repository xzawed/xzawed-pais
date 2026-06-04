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
  | {
      type: 'agent_info_request'
      agentId: string
      content: string
      uiSpec?: unknown
      approval?: { stage: string; summary: string; mode: 'manual' }
    }
  | { type: 'knowledge_changed'; projectId?: string }

export interface CreateSessionResponse {
  sessionId: string
}

export interface PostMessageResponse {
  messageId: string
  status: 'accepted'
}

export async function createSession(
  baseUrl: string,
  userId: string,
  accessToken?: string | null,
): Promise<CreateSessionResponse> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`)
  return res.json() as Promise<CreateSessionResponse>
}

export async function postMessage(
  baseUrl: string,
  sessionId: string,
  content: string,
  gateMode?: 'manual' | 'auto',
  accessToken?: string | null,
): Promise<PostMessageResponse> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ content, ...(gateMode ? { gateMode } : {}) }),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`)
  return res.json() as Promise<PostMessageResponse>
}

/**
 * 사용자의 UI 액션(승인 게이트 결정·명확화 응답)을 서버로 전송한다.
 * 서버는 이를 Manager에 `info_response{answer: action}`으로 발행한다(WS 수신 핸들러 없음 → HTTP 경로 사용).
 */
export async function postUiAction(
  baseUrl: string,
  sessionId: string,
  action: string,
  accessToken?: string | null,
): Promise<void> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/ui-actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(`postUiAction failed: ${res.status}`)
}

export interface KnowledgeItem {
  id: number
  content: string
  sourceAgent: string
  category?: string
  createdAt: string
  /** 승인 게이트 저장 항목의 승인자(userId). provenance·audit 표시용. */
  approver?: string
}

/**
 * 프로젝트에 누적된 도메인 지식을 조회한다(Orchestrator → Manager 프록시).
 * query가 있으면 content 검색, source가 있으면 산출 에이전트로, category가 있으면 의미 분류로 필터. 실패 시 빈 배열.
 */
/** 위키 조회 응답을 KnowledgeItem[]로 파싱(getKnowledge·getDeletedKnowledge 공유). 실패 시 빈 배열. */
async function fetchKnowledgeItems(url: URL): Promise<KnowledgeItem[]> {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json() as { items?: KnowledgeItem[] }
  return Array.isArray(data.items) ? data.items : []
}

export async function getKnowledge(
  baseUrl: string,
  projectId: string,
  query?: string,
  source?: string,
  category?: string,
): Promise<KnowledgeItem[]> {
  validateBaseUrl(baseUrl)
  const url = new URL(`${baseUrl}/projects/${projectId}/knowledge`)
  if (query) url.searchParams.set('q', query)
  if (source) url.searchParams.set('source', source)
  if (category) url.searchParams.set('category', category)
  return fetchKnowledgeItems(url)
}

/** soft-delete된 도메인 지식(휴지통)을 조회한다(Orchestrator → Manager 프록시, ?deleted=true). 실패 시 빈 배열. */
export async function getDeletedKnowledge(baseUrl: string, projectId: string): Promise<KnowledgeItem[]> {
  validateBaseUrl(baseUrl)
  const url = new URL(`${baseUrl}/projects/${projectId}/knowledge`)
  url.searchParams.set('deleted', 'true')
  return fetchKnowledgeItems(url)
}

/**
 * 도메인 지식 항목을 수정한다(Orchestrator → Manager 프록시, PATCH).
 * category가 null이면 분류 해제. non-ok면 throw.
 */
export async function updateKnowledge(
  baseUrl: string,
  projectId: string,
  id: number,
  content: string,
  category: string | null,
  accessToken?: string,
): Promise<void> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/projects/${projectId}/knowledge/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ content, category }),
  })
  if (!res.ok) throw new Error(`updateKnowledge failed: ${res.status}`)
}

/**
 * 도메인 지식 항목을 삭제한다(Orchestrator → Manager 프록시, DELETE).
 * AUTH=jwt 환경에선 accessToken을 Authorization 헤더로 전달. non-ok면 throw.
 */
export async function deleteKnowledge(
  baseUrl: string,
  projectId: string,
  id: number,
  accessToken?: string,
): Promise<void> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/projects/${projectId}/knowledge/${id}`, {
    method: 'DELETE',
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  })
  if (!res.ok) throw new Error(`deleteKnowledge failed: ${res.status}`)
}

/**
 * soft-delete된 도메인 지식 항목을 복구한다(Orchestrator → Manager 프록시, POST /:id/restore).
 * AUTH=jwt 환경에선 accessToken을 Authorization 헤더로 전달. non-ok면 throw.
 */
export async function restoreKnowledge(
  baseUrl: string,
  projectId: string,
  id: number,
  accessToken?: string,
): Promise<void> {
  validateBaseUrl(baseUrl)
  const res = await fetch(`${baseUrl}/projects/${projectId}/knowledge/${id}/restore`, {
    method: 'POST',
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  })
  if (!res.ok) throw new Error(`restoreKnowledge failed: ${res.status}`)
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
    onClose?: () => void,
    accessToken?: string | null,
  ): () => void {
    validateBaseUrl(baseUrl)
    const base = new URL(baseUrl)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = `/ws/sessions/${sessionId}`
    base.search = ''
    base.hash = ''
    const wsUrl = base.toString()
    // Browsers can't set an Authorization header on the WS upgrade — pass the
    // token via the Sec-WebSocket-Protocol subprotocol (`bearer.<token>`), which
    // the server's user-auth hook accepts as a fallback. (AUTH=jwt)
    this.ws = accessToken ? new WebSocket(wsUrl, [`bearer.${accessToken}`]) : new WebSocket(wsUrl)

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

  send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
