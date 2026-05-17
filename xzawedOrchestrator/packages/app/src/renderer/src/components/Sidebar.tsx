// src/renderer/src/components/Sidebar.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { useIntegrationsStore, type ActivePanel } from '../store/integrations.store.js'
import { createSession } from '../lib/api.js'

export function Sidebar(): React.JSX.Element {
  const { settings, serverStatus, toggleSettings } = useAppStore()
  const { initSession } = useChatStore()
  const { activePanel, sidebarMode, setActivePanel, setSidebarMode } = useIntegrationsStore()
  const [isCreating, setIsCreating] = useState(false)
  const [autoCompact, setAutoCompact] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setAutoCompact(window.innerWidth < 900)
    })
    observer.observe(document.body)
    setAutoCompact(window.innerWidth < 900)
    return () => observer.disconnect()
  }, [])

  const isCompact =
    sidebarMode === 'compact' || (sidebarMode === 'auto' && autoCompact)

  async function handleNewSession(): Promise<void> {
    if (isCreating) return
    setIsCreating(true)
    try {
      const { sessionId } = await createSession(settings.serverUrl, settings.userId)
      initSession(sessionId)
      setActivePanel('chat')
    } catch (err) {
      console.error('Failed to create session:', err)
    } finally {
      setIsCreating(false)
    }
  }

  function navItem(panel: ActivePanel, icon: string, label: string): React.JSX.Element {
    const active = activePanel === panel
    return (
      <button
        key={panel}
        className={`sidebar-nav-item ${active ? 'active' : ''} ${isCompact ? 'compact' : ''}`}
        onClick={() => setActivePanel(panel)}
        title={isCompact ? label : undefined}
      >
        <span className="sidebar-nav-icon">{icon}</span>
        {!isCompact && <span className="sidebar-nav-label">{label}</span>}
      </button>
    )
  }

  return (
    <div ref={containerRef} className={`sidebar ${isCompact ? 'sidebar--compact' : 'sidebar--expanded'}`}>
      <button
        className="sidebar-mode-toggle"
        onClick={() => setSidebarMode(sidebarMode === 'auto' ? (isCompact ? 'expanded' : 'compact') : 'auto')}
        title={isCompact ? '사이드바 펼치기' : '사이드바 접기'}
      >
        {isCompact ? '›' : '‹'}
      </button>

      <button
        className={`sidebar-btn new-session ${isCompact ? 'compact' : ''}`}
        onClick={handleNewSession}
        disabled={isCreating}
        title={isCompact ? 'New Session' : undefined}
      >
        {isCompact ? '+' : (isCreating ? 'Creating...' : '+ New Session')}
      </button>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav">
        {navItem('github', '🐙', 'GitHub')}
        {navItem('mcp', '🔌', 'MCP 서버')}
        {navItem('plugins', '📦', 'Plugins')}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        {!isCompact && (
          <div className="sidebar-status">
            <span className={`status-dot ${serverStatus}`} />
            Server: {serverStatus}
          </div>
        )}
        <button
          className={`sidebar-btn ${isCompact ? 'compact' : ''}`}
          onClick={toggleSettings}
          title={isCompact ? '설정' : undefined}
        >
          {isCompact ? '⚙️' : 'Settings'}
        </button>
      </div>
    </div>
  )
}
