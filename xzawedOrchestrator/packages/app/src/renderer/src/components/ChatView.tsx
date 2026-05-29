import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import type { Message } from '@xzawed/shared'
import { useProjectsStore } from '@xzawed/ui'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { UserBubble } from './chat/UserBubble.js'
import { AgentTimelineCard } from './chat/AgentTimelineCard.js'
import { PipelineStrip } from './chat/PipelineStrip.js'
import { MessageInput } from './MessageInput.js'
import { ProjectContextBar } from './ProjectContextBar.js'
import { ScrollArea } from './ui/scroll-area.js'
import { parseAgentSteps } from '../lib/parseAgentSteps.js'
import { postMessage, SessionWsClient } from '../lib/api.js'

export function ChatView(): React.JSX.Element {
  const { t } = useTranslation('app')
  const {
    sessionId, messages, streamingContent, streamingMsgId, isStreaming, isPending,
  } = useChatStore()
  const { settings } = useAppStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const { projectId } = useParams<{ projectId?: string }>()
  const navigate = useNavigate()
  const projects = useProjectsStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === projectId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    if (!sessionId) return
    const client = new SessionWsClient()
    const teardown = client.connect(settings.serverUrl, sessionId, (msg) => {
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
      } else if (msg.type === 'agent_done') {
        store.addMessage({
          id: crypto.randomUUID(),
          sessionId,
          role: 'assistant',
          content: msg.content,
          timestamp: Date.now(),
        })
      } else if (msg.type === 'agent_error') {
        store.addMessage({
          id: crypto.randomUUID(),
          sessionId,
          role: 'assistant',
          content: `[에이전트 오류 - ${msg.agentId}] ${msg.content}`,
          timestamp: Date.now(),
        })
      }
    }, () => { useChatStore.getState().cancelStream() })
    return teardown
  }, [sessionId, settings.serverUrl])

  async function handleSend(content: string): Promise<void> {
    if (!sessionId) return
    const store = useChatStore.getState()
    store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'user', content, timestamp: Date.now() })
    store.setPending(true)
    try {
      await postMessage(settings.serverUrl, sessionId, content)
    } catch (err) {
      store.setPending(false)
      store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${err instanceof Error ? err.message : String(err)}`, timestamp: Date.now() })
    }
  }

  const streamingMessage = useMemo<Message | null>(
    () =>
      isStreaming && streamingMsgId
        ? { id: streamingMsgId, sessionId: sessionId ?? '', role: 'assistant' as const, content: streamingContent, timestamp: 0 }
        : null,
    [isStreaming, streamingMsgId, streamingContent, sessionId]
  )

  const lastMsgContent = messages.at(-1)?.content ?? ''
  const streamingSteps = isStreaming && streamingContent
    ? parseAgentSteps(streamingContent, true)
    : parseAgentSteps(lastMsgContent, false)

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">

      {!sessionId ? (
        <div data-testid="empty-chat-message" className="flex flex-1 flex-col items-center justify-center bg-bg text-fg-ghost">
          <div className="mb-2 text-4xl">💬</div>
          <p className="text-sm text-fg-muted">{t('chat.empty_state')}</p>
          <p className="mt-1 text-[10px] text-fg-ghost">사이드바의 <strong className="text-fg-dim">+ 새 세션</strong> 버튼을 클릭하거나 <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-[9px]">⌘K</kbd>를 누르세요</p>
        </div>
      ) : (
        <>
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-ok" />
            <span className="text-[13px] font-semibold text-fg">{t('sidebar.current_session')}</span>
            <span data-testid="session-id-display" className="text-[10px] text-fg-ghost font-mono">{sessionId}</span>
            <div className="ml-auto">
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] text-fg-ghost">⌘K</kbd>
            </div>
          </div>

          {/* Pipeline strip */}
          <PipelineStrip steps={streamingSteps} />

          {/* Messages */}
          <ScrollArea className="flex-1 min-h-0">
            <div data-testid="chat-message-list" className="flex flex-col gap-4 px-4 py-4">
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
                <div data-testid="streaming-indicator" className="flex items-center gap-1.5 py-1">
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
        </>
      )}

      {/* Project context bar — always visible so E2E can assert it after project selection */}
      <div className="flex flex-col">
        <ProjectContextBar
          projectName={activeProject?.name ?? null}
          workspacePath={activeProject?.workspace_path ?? null}
          workspaceType={activeProject?.workspace_type ?? null}
          onSwitch={() => { navigate('/projects') }}
        />
      </div>
    </div>
  )
}
