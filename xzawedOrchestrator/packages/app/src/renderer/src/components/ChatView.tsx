import React, { useEffect, useRef } from 'react'
import type { Message } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { MessageBubble } from './MessageBubble.js'
import { MessageInput } from './MessageInput.js'
import { postMessage, SessionWsClient } from '../lib/api.js'

export function ChatView(): React.JSX.Element {
  const { sessionId, messages, streamingContent, streamingMsgId, isStreaming, isPending } =
    useChatStore()
  const {
    initSession: _init,
    addMessage,
    setPending,
    startStream,
    appendChunk,
    finalizeStream,
  } = useChatStore.getState()
  const { settings } = useAppStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const wsClientRef = useRef<SessionWsClient | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Connect WebSocket when sessionId changes
  useEffect(() => {
    if (!sessionId) return

    const client = new SessionWsClient()
    wsClientRef.current = client

    const teardown = client.connect(settings.serverUrl, sessionId, (msg) => {
      if (msg.type === 'chunk') {
        const state = useChatStore.getState()
        if (state.streamingMsgId !== msg.messageId) {
          startStream(msg.messageId)
        }
        appendChunk(msg.content)
      } else if (msg.type === 'done') {
        finalizeStream(msg.messageId)
      } else if (msg.type === 'error') {
        setPending(false)
        const errMsg: Message = {
          id: crypto.randomUUID(),
          sessionId,
          role: 'assistant',
          content: `[Error] ${msg.content}`,
          timestamp: Date.now(),
        }
        addMessage(errMsg)
      }
    }, () => {
      useChatStore.getState().cancelStream()
    })

    teardownRef.current = teardown

    return () => {
      teardown()
      teardownRef.current = null
      wsClientRef.current = null
    }
  }, [sessionId, settings.serverUrl])

  async function handleSend(content: string): Promise<void> {
    if (!sessionId) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    addMessage(userMsg)

    try {
      await postMessage(settings.serverUrl, sessionId, content)
      setPending(true)
    } catch (err) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        sessionId,
        role: 'assistant',
        content: `[Error] ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }
      addMessage(errMsg)
    }
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-bg">
        <div className="flex flex-1 items-center justify-center text-fg-ghost text-sm">새 세션을 시작해주세요</div>
      </div>
    )
  }

  const streamingMessage: Message | null =
    isStreaming && streamingMsgId
      ? {
          id: streamingMsgId,
          sessionId,
          role: 'assistant',
          content: streamingContent,
          timestamp: Date.now(),
        }
      : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMessage && (
          <MessageBubble key="streaming" message={streamingMessage} streaming />
        )}
        {isPending && !isStreaming && (
          <div className="flex items-center gap-1 px-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-accent"
                style={{ animation: `pulse 1s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={isStreaming || isPending} />
    </div>
  )
}
