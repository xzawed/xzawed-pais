import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { UiSpecPreview } from './chat/UiSpecPreview.js'
import { parseAgentSteps } from '../lib/parseAgentSteps.js'
import { postMessage, postUiAction } from '../lib/api.js'

/** 지식성 단계(도메인 지식 산출) — 승인 시 '위키에 저장' 체크박스를 이 단계에서만 노출. Manager 가드와 동일 집합. */
const KNOWLEDGE_BEARING_STAGES = new Set(['plan_task', 'design_ui', 'develop_code', 'security_audit'])

export function ChatView(): React.JSX.Element {
  const { t } = useTranslation('app')
  const {
    sessionId, messages, streamingContent, streamingMsgId, isStreaming, isPending, pendingInfoRequest, uiSpec,
  } = useChatStore()
  const { settings } = useAppStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [infoResponseValue, setInfoResponseValue] = useState('')
  const [rememberAuto, setRememberAuto] = useState(false)
  const [saveToWiki, setSaveToWiki] = useState(false)
  const [wikiSummary, setWikiSummary] = useState('')
  const { projectId } = useParams<{ projectId?: string }>()
  const navigate = useNavigate()
  const projects = useProjectsStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === projectId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // 세션 WS 구독은 ChatLayout(항상 마운트)의 useSessionWs로 이관 — 패널 전환 시 끊김 방지.
  // ChatView는 chat.store만 읽어 렌더한다.

  async function handleSend(content: string): Promise<void> {
    if (!sessionId) return
    const store = useChatStore.getState()
    store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'user', content, timestamp: Date.now() })
    store.setPending(true)
    try {
      await postMessage(settings.serverUrl, sessionId, content, settings.gateMode)
    } catch (err) {
      store.setPending(false)
      store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${err instanceof Error ? err.message : String(err)}`, timestamp: Date.now() })
    }
  }

  function sendUiAction(action: string, echo: string): void {
    if (!sessionId) return
    const store = useChatStore.getState()
    store.addMessage({ id: crypto.randomUUID(), sessionId, role: 'user', content: echo, timestamp: Date.now() })
    void postUiAction(settings.serverUrl, sessionId, action).catch((err: unknown) => {
      store.addMessage({
        id: crypto.randomUUID(), sessionId, role: 'assistant',
        content: `[Error] ${err instanceof Error ? err.message : String(err)}`, timestamp: Date.now(),
      })
    })
    store.setPendingInfoRequest(null)
    setInfoResponseValue('')
    setRememberAuto(false)
    setSaveToWiki(false)
    setWikiSummary('')
  }

  function handleInfoResponseSend(): void {
    const trimmed = infoResponseValue.trim()
    if (!trimmed) return
    sendUiAction(trimmed, trimmed)
  }

  function handleInfoResponseKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleInfoResponseSend()
    }
  }

  function handleApprovalDecision(decision: 'approve' | 'revise' | 'abort'): void {
    if (decision === 'revise') {
      const feedback = infoResponseValue.trim()
      if (!feedback) return
      sendUiAction(JSON.stringify({ decision, feedback }), `${t('approval.revise')}: ${feedback}`)
      return
    }
    if (decision === 'approve') {
      // PO가 저장 전 요약을 실제로 편집했을 때만 wikiSummary를 실어 보낸다(미편집 시 Manager가 자동 요약 사용).
      const original = pendingInfoRequest?.approval?.summary ?? ''
      const edited = saveToWiki && wikiSummary.trim() !== '' && wikiSummary !== original
      sendUiAction(
        JSON.stringify({ decision, rememberAuto, saveToWiki, ...(edited ? { wikiSummary } : {}) }),
        t('approval.approve'),
      )
      return
    }
    sendUiAction(JSON.stringify({ decision }), t('approval.abort'))
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

          {/* Agent info request inline prompt */}
          {pendingInfoRequest && (
            <div
              data-testid="agent-info-request"
              className="border-t border-border bg-surface px-4 py-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-warn flex-shrink-0" />
                <span className="text-[11px] font-medium text-fg-dim">
                  {pendingInfoRequest.approval
                    ? t('approval.title', { stage: pendingInfoRequest.approval.stage })
                    : `Agent (${pendingInfoRequest.agentId}) is requesting additional input`}
                </span>
              </div>
              <p
                data-testid="agent-info-request-prompt"
                className="text-[12px] text-fg px-2 py-1.5 rounded bg-surface-raised border border-border whitespace-pre-wrap"
              >
                {pendingInfoRequest.approval?.summary ?? pendingInfoRequest.prompt}
              </p>

              {pendingInfoRequest.approval?.stage === 'design_ui' && uiSpec && (
                <UiSpecPreview spec={uiSpec} />
              )}

              {pendingInfoRequest.approval ? (
                <div data-testid="approval-actions" className="flex flex-col gap-2">
                  <textarea
                    data-testid="approval-feedback-input"
                    value={infoResponseValue}
                    onChange={(e) => setInfoResponseValue(e.target.value)}
                    placeholder={t('approval.feedback_placeholder')}
                    rows={2}
                    className="resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg placeholder:text-fg-ghost outline-none focus:border-accent transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      data-testid="approval-approve"
                      onClick={() => handleApprovalDecision('approve')}
                      className="h-8 px-3 rounded text-[11px] bg-ok text-white transition-colors"
                    >
                      {t('approval.approve')}
                    </button>
                    <button
                      data-testid="approval-revise"
                      onClick={() => handleApprovalDecision('revise')}
                      disabled={!infoResponseValue.trim()}
                      className="h-8 px-3 rounded text-[11px] bg-accent text-white disabled:opacity-30 transition-colors"
                    >
                      {t('approval.revise')}
                    </button>
                    <button
                      data-testid="approval-abort"
                      onClick={() => handleApprovalDecision('abort')}
                      className="h-8 px-3 rounded text-[11px] bg-danger text-white transition-colors ml-auto"
                    >
                      {t('approval.abort')}
                    </button>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-fg-muted select-none">
                    <input
                      data-testid="approval-remember-auto"
                      type="checkbox"
                      checked={rememberAuto}
                      onChange={(e) => setRememberAuto(e.target.checked)}
                      className="accent-accent"
                    />
                    {t('approval.remember_auto')}
                  </label>
                  {KNOWLEDGE_BEARING_STAGES.has(pendingInfoRequest.approval.stage) && (
                    <>
                      <label className="flex items-center gap-1.5 text-[11px] text-fg-muted select-none">
                        <input
                          data-testid="approval-save-wiki"
                          type="checkbox"
                          checked={saveToWiki}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setSaveToWiki(checked)
                            // 체크 시 자동 요약을 편집 필드에 prefill — PO가 저장 전 다듬을 수 있게 한다
                            if (checked) setWikiSummary(pendingInfoRequest.approval?.summary ?? '')
                          }}
                          className="accent-accent"
                        />
                        {t('approval.save_to_wiki')}
                      </label>
                      {saveToWiki && (
                        <textarea
                          data-testid="approval-wiki-summary"
                          value={wikiSummary}
                          onChange={(e) => setWikiSummary(e.target.value)}
                          aria-label={t('approval.wiki_summary')}
                          placeholder={t('approval.wiki_summary')}
                          rows={3}
                          className="resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg placeholder:text-fg-ghost outline-none focus:border-accent transition-colors"
                        />
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    data-testid="agent-info-response-input"
                    value={infoResponseValue}
                    onChange={(e) => setInfoResponseValue(e.target.value)}
                    onKeyDown={handleInfoResponseKeyDown}
                    placeholder="Type your response..."
                    rows={2}
                    className="flex-1 resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg placeholder:text-fg-ghost outline-none focus:border-accent transition-colors"
                  />
                  <button
                    data-testid="agent-info-response-send"
                    onClick={handleInfoResponseSend}
                    disabled={!infoResponseValue.trim()}
                    className="h-8 px-3 rounded text-[11px] bg-accent text-white disabled:opacity-30 transition-colors flex-shrink-0"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <MessageInput onSend={handleSend} disabled={isStreaming || isPending || !!pendingInfoRequest} />
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
