import { useEffect, useRef } from 'react'
import type { UISpec } from '@xzawed/shared'
import { useAuthStore } from '@xzawed/ui'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { SessionWsClient, type WsMessage } from './api.js'

/** 재연결 지수 백오프 — 서버 grace(WS_CLEANUP_GRACE_MS, 기본 15s) 안에 첫 시도가 들어가도록 짧게 시작한다. */
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000

/**
 * 세션 WebSocket을 항상-마운트 위치(ChatLayout)에서 소유·구독한다.
 * ActivityBar 패널 전환(예: 위키 탭)으로 ChatView가 언마운트돼도 연결이 끊기지 않아,
 * 진행 중 스트림과 knowledge_changed(위키 실시간 갱신) 이벤트가 유실되지 않는다.
 * 수신 메시지는 모두 chat.store로 디스패치 — ChatView·WikiPanel은 store만 읽는다.
 *
 * 예기치 않은 끊김(서버 재기동·네트워크 단절)에는 지수 백오프로 자동 재연결하며,
 * 매 시도마다 store의 최신 액세스 토큰을 재첨부한다. 서버가 grace 내 재연결을 세션 유지로
 * 처리하므로(`WS_CLEANUP_GRACE_MS`), 짧은 단절에도 세션이 끊기지 않는다.
 * 의도적 정리(언마운트·sessionId/serverUrl 변경)는 재연결하지 않는다.
 */
export function useSessionWs(): void {
  const sessionId = useChatStore((s) => s.sessionId)
  const serverUrl = useAppStore((s) => s.settings.serverUrl)
  // 토큰 변경(예: 늦게 도착한 인증) 시 깨끗한 재연결을 위해 deps에 포함하되,
  // 실제 연결에는 (재연결 포함) 항상 getState()의 최신 토큰을 사용한다.
  const accessToken = useAuthStore((s) => s.accessToken)
  const clientRef = useRef<SessionWsClient | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const sid: string = sessionId // 중첩 함수(open) 클로저에서 string 좁힘 유지
    let disposed = false
    let attempt = 0
    let settled = false // 한 연결 사이클의 close/error 중복 호출 가드
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let teardown: (() => void) | null = null

    const clearReconnect = (): void => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = (): void => {
      clearReconnect()
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
      attempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (disposed) return
        open()
      }, delay)
    }

    function open(): void {
      settled = false
      const client = new SessionWsClient()
      clientRef.current = client
      teardown = client.connect(
        serverUrl,
        sid,
        (msg) => handleWsMessage(msg, sid),
        () => {
          if (settled) return // error→close 쌍 중 두 번째는 무시
          settled = true
          clientRef.current = null
          useChatStore.getState().cancelStream()
          if (disposed) return
          scheduleReconnect()
        },
        useAuthStore.getState().accessToken,
        () => {
          attempt = 0 // 연결 성공 → 백오프 리셋
        },
      )
    }

    open()

    return () => {
      disposed = true
      clearReconnect()
      teardown?.()
      clientRef.current = null
    }
  }, [sessionId, serverUrl, accessToken])
}

/** WsMessage가 런타임에 uiSpec(승인 데모·디자인 산출물)을 동반하면 store에 반영. WsMessage 타입엔 미선언이라 런타임 동반 시에만. */
function applyUiSpec(store: ReturnType<typeof useChatStore.getState>, msg: WsMessage): void {
  const maybeUiSpec = (msg as { uiSpec?: unknown }).uiSpec
  if (maybeUiSpec) store.setUiSpec(maybeUiSpec as UISpec)
}

/** WS 수신 메시지를 chat.store 변이로 디스패치한다(switch로 인지 복잡도 최소화). */
function handleWsMessage(msg: WsMessage, sessionId: string): void {
  const store = useChatStore.getState()
  switch (msg.type) {
    case 'chunk': {
      if (store.streamingMsgId !== msg.messageId) store.startStream(msg.messageId)
      store.appendChunk(msg.content)
      const lines = msg.content.split('\n').filter((l) => /^\[[A-Z]{2,3}\]/.exec(l))
      lines.forEach((l) => store.addLogLine(l.trim()))
      break
    }
    case 'done':
      store.finalizeStream(msg.messageId)
      break
    case 'error':
      store.setPending(false)
      store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${msg.content}`, timestamp: Date.now() })
      break
    case 'status':
      store.addLogLine(`[STATUS] ${msg.content}`)
      break
    case 'agent_status': {
      const agentTag = (msg.agentId ?? 'AGENT').toUpperCase().slice(0, 8)
      store.addLogLine(`[${agentTag}] ${msg.content}`)
      applyUiSpec(store, msg)
      break
    }
    case 'agent_done':
      store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: msg.content, timestamp: Date.now() })
      break
    case 'agent_error':
      store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[에이전트 오류 - ${msg.agentId}] ${msg.content}`, timestamp: Date.now() })
      break
    case 'agent_info_request':
      // 승인 게이트(P4)는 info_request에 uiSpec(데모)을 동반할 수 있다.
      applyUiSpec(store, msg)
      store.setPendingInfoRequest({
        agentId: msg.agentId,
        prompt: msg.content,
        ...(msg.approval ? { approval: msg.approval } : {}),
      })
      break
    case 'knowledge_changed':
      // 위키 지식 변경 → WikiPanel 즉시 새로고침(projectId 일치 시). projectId 없으면 무시.
      if (msg.projectId) store.notifyKnowledgeChange(msg.projectId)
      break
  }
}
