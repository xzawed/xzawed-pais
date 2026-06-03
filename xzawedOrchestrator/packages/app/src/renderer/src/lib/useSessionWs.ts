import { useEffect, useRef } from 'react'
import type { UISpec } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { SessionWsClient, type WsMessage } from './api.js'

/**
 * 세션 WebSocket을 항상-마운트 위치(ChatLayout)에서 소유·구독한다.
 * ActivityBar 패널 전환(예: 위키 탭)으로 ChatView가 언마운트돼도 연결이 끊기지 않아,
 * 진행 중 스트림과 knowledge_changed(위키 실시간 갱신) 이벤트가 유실되지 않는다.
 * 수신 메시지는 모두 chat.store로 디스패치 — ChatView·WikiPanel은 store만 읽는다.
 */
export function useSessionWs(): void {
  const sessionId = useChatStore((s) => s.sessionId)
  const serverUrl = useAppStore((s) => s.settings.serverUrl)
  const clientRef = useRef<SessionWsClient | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const client = new SessionWsClient()
    clientRef.current = client
    const teardown = client.connect(
      serverUrl,
      sessionId,
      (msg) => handleWsMessage(msg, sessionId),
      () => {
        useChatStore.getState().cancelStream()
        clientRef.current = null
      },
    )
    return () => {
      teardown()
      clientRef.current = null
    }
  }, [sessionId, serverUrl])
}

/** WS 수신 메시지를 chat.store 변이로 디스패치한다. */
function handleWsMessage(msg: WsMessage, sessionId: string): void {
  const store = useChatStore.getState()
  if (msg.type === 'chunk') {
    if (store.streamingMsgId !== msg.messageId) store.startStream(msg.messageId)
    store.appendChunk(msg.content)
    const lines = msg.content.split('\n').filter((l) => /^\[[A-Z]{2,3}\]/.exec(l))
    lines.forEach((l) => store.addLogLine(l.trim()))
  } else if (msg.type === 'done') {
    store.finalizeStream(msg.messageId)
  } else if (msg.type === 'error') {
    store.setPending(false)
    store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${msg.content}`, timestamp: Date.now() })
  } else if (msg.type === 'status') {
    store.addLogLine(`[STATUS] ${msg.content}`)
  } else if (msg.type === 'agent_status') {
    const agentTag = (msg.agentId ?? 'AGENT').toUpperCase().slice(0, 8)
    store.addLogLine(`[${agentTag}] ${msg.content}`)
    // agent_status는 uiSpec을 동반할 수 있으나 WsMessage 타입엔 미선언 — 런타임 동반 시에만 반영.
    const maybeUiSpec = (msg as { uiSpec?: unknown }).uiSpec
    if (maybeUiSpec) store.setUiSpec(maybeUiSpec as UISpec)
  } else if (msg.type === 'agent_done') {
    store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: msg.content, timestamp: Date.now() })
  } else if (msg.type === 'agent_error') {
    store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[에이전트 오류 - ${msg.agentId}] ${msg.content}`, timestamp: Date.now() })
  } else if (msg.type === 'agent_info_request') {
    store.setPendingInfoRequest({
      agentId: msg.agentId,
      prompt: msg.content,
      ...(msg.approval !== undefined ? { approval: msg.approval } : {}),
    })
  } else if (msg.type === 'knowledge_changed') {
    // 위키 지식 변경 → WikiPanel 즉시 새로고침(projectId 일치 시). projectId 없으면 무시.
    if (msg.projectId) store.notifyKnowledgeChange(msg.projectId)
  }
}
