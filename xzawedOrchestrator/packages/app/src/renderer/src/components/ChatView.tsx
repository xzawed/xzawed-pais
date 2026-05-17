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
      const githubToken = await window.electronAPI?.githubGetToken() ?? undefined
      await postMessage(settings.serverUrl, sessionId, content, githubToken)
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
      <div className="chat-panel">
        <div className="empty-state">Start a new session from the sidebar</div>
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
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMessage && (
          <MessageBubble key="streaming" message={streamingMessage} streaming />
        )}
        {isPending && !isStreaming && (
          <div className="typing-indicator">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={isStreaming || isPending} />
    </div>
  )
}
