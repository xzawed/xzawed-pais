import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@xzawed/ui'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface WsMessage {
  type: 'connected' | 'chunk' | 'done' | 'error'
  content?: string
}

interface Props {
  serverUrl: string
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function WebChatView({ serverUrl }: Readonly<Props>): React.JSX.Element {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { accessToken } = useAuthStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  useEffect(() => {
    return () => { wsRef.current?.close() }
  }, [])

  const initSession = async (): Promise<string> => {
    const res = await fetch(`${serverUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
      body: JSON.stringify({ projectId }),
    })
    if (!res.ok) throw new Error('Failed to create session')
    const data = (await res.json()) as { sessionId: string }
    return data.sessionId
  }

  function handleWsMessage(msg: WsMessage): void {
    if (msg.type === 'chunk' && msg.content) {
      setStreamBuffer((prev) => prev + msg.content)
    } else if (msg.type === 'done') {
      setStreamBuffer((prev) => {
        if (prev) setMessages((m) => [...m, { role: 'assistant', content: prev }])
        return ''
      })
      setIsStreaming(false)
    } else if (msg.type === 'error') {
      setIsStreaming(false)
      setStreamBuffer('')
    }
  }

  const connectWs = (sid: string): void => {
    const wsUrl = `${serverUrl.replace(/^http/, 'ws')}/ws/sessions/${sid}`
    const protocols = accessToken ? [`bearer.${accessToken}`] : []
    const ws = new WebSocket(wsUrl, protocols)
    wsRef.current = ws
    ws.onmessage = (ev) => handleWsMessage(JSON.parse(ev.data as string) as WsMessage)
  }

  const sendMessage = async (): Promise<void> => {
    if (!input.trim() || isStreaming) return
    const text = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setIsStreaming(true)

    try {
      let sid = sessionId
      if (!sid) {
        sid = await initSession()
        setSessionId(sid)
        connectWs(sid)
        await new Promise((r) => setTimeout(r, 200))
      }

      await fetch(`${serverUrl}/sessions/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
        body: JSON.stringify({ content: text }),
      })
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${String(err)}` }])
      setIsStreaming(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="text-sm text-fg-muted hover:text-fg"
        >
          ← Projects
        </button>
        <span className="text-sm font-medium text-fg">Project {projectId}</span>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={`${i}:${msg.role}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-accent text-white'
                  : 'bg-surface border border-border text-fg'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {streamBuffer && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-xl border border-border bg-surface px-4 py-2 text-sm text-fg">
              {streamBuffer}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-4">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { void sendMessage() } }}
            placeholder="Message…"
            disabled={isStreaming}
            className="flex-1 rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={isStreaming || !input.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
