import React, { useEffect, useRef } from 'react'
import type { Message } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { UserBubble } from './chat/UserBubble.js'
import { AgentTimelineCard } from './chat/AgentTimelineCard.js'
import { PipelineStrip } from './chat/PipelineStrip.js'
import { MessageInput } from './MessageInput.js'
import { ScrollArea } from './ui/scroll-area.js'
import { parseAgentSteps } from '../lib/parseAgentSteps.js'
import { postMessage, SessionWsClient } from '../lib/api.js'

export function ChatView(): React.JSX.Element {
  const {
    sessionId, messages, streamingContent, streamingMsgId, isStreaming, isPending,
  } = useChatStore()
  const {
    initSession: _init, addMessage, setPending, startStream,
    appendChunk, finalizeStream, addLogLine,
  } = useChatStore.getState()
  const { settings } = useAppStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    if (!sessionId) return
    const client = new SessionWsClient()
    const teardown = client.connect(settings.serverUrl, sessionId, (msg) => {
      if (msg.type === 'chunk') {
        const state = useChatStore.getState()
        if (state.streamingMsgId !== msg.messageId) startStream(msg.messageId)
        appendChunk(msg.content)
        const lines = msg.content.split('\n').filter((l) => /^\[[A-Z]{2,3}\]/.exec(l))
        lines.forEach((l) => addLogLine(l.trim()))
      } else if (msg.type === 'done') {
        finalizeStream(msg.messageId)
      } else if (msg.type === 'error') {
        setPending(false)
        addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${msg.content}`, timestamp: Date.now() })
      }
    }, () => { useChatStore.getState().cancelStream() })
    return teardown
  }, [sessionId, settings.serverUrl])

  async function handleSend(content: string): Promise<void> {
    if (!sessionId) return
    addMessage({ id: crypto.randomUUID(), sessionId, role: 'user', content, timestamp: Date.now() })
    try {
      await postMessage(settings.serverUrl, sessionId, content)
      setPending(true)
    } catch (err) {
      addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${err instanceof Error ? err.message : String(err)}`, timestamp: Date.now() })
    }
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-bg text-fg-ghost">
        <div className="mb-2 text-4xl">💬</div>
        <p className="text-sm text-fg-muted">새 세션을 시작해주세요</p>
        <p className="mt-1 text-[10px] text-fg-ghost">사이드바의 <strong className="text-fg-dim">+ 새 세션</strong> 버튼을 클릭하거나 <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-[9px]">⌘K</kbd>를 누르세요</p>
      </div>
    )
  }

  const lastMsgContent = messages.at(-1)?.content ?? ''
  const streamingSteps = isStreaming && streamingContent
    ? parseAgentSteps(streamingContent, true)
    : parseAgentSteps(lastMsgContent, false)

  const streamingMessage: Message | null =
    isStreaming && streamingMsgId
      ? { id: streamingMsgId, sessionId, role: 'assistant', content: streamingContent, timestamp: Date.now() }
      : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">

      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-ok" />
        <span className="text-[13px] font-semibold text-fg">현재 세션</span>
        <div className="ml-auto">
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] text-fg-ghost">⌘K</kbd>
        </div>
      </div>

      {/* Pipeline strip */}
      <PipelineStrip steps={streamingSteps} />

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 px-4 py-4">
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserBubble key={msg.id} message={msg} />
            ) : (
              <AgentTimelineCard key={msg.id} message={msg} streaming={false} />
            )
          )}
          {streamingMessage && (
            <AgentTimelineCard key="streaming" message={streamingMessage} streaming />
          )}
          {isPending && !isStreaming && (
            <div className="flex items-center gap-1.5 py-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-accent"
                  style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <MessageInput onSend={handleSend} disabled={isStreaming || isPending} />
    </div>
  )
}
