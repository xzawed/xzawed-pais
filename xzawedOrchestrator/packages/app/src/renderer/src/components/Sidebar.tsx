import React, { useState } from 'react'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { createSession } from '../lib/api.js'

export function Sidebar(): React.JSX.Element {
  const { settings, serverStatus, toggleSettings } = useAppStore()
  const { initSession } = useChatStore()
  const [isCreating, setIsCreating] = useState(false)

  async function handleNewSession(): Promise<void> {
    if (isCreating) return
    setIsCreating(true)
    try {
      const { sessionId } = await createSession(settings.serverUrl, settings.userId)
      initSession(sessionId)
    } catch (err) {
      console.error('Failed to create session:', err)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="sidebar">
      <button className="sidebar-btn" onClick={handleNewSession} disabled={isCreating}>
        {isCreating ? 'Creating...' : '+ New Session'}
      </button>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ fontSize: 12, color: '#6a6a8a', marginBottom: 8 }}>
          <span
            className={`status-dot ${serverStatus}`}
          />
          Server: {serverStatus}
        </div>
        <button className="sidebar-btn" onClick={toggleSettings}>
          Settings
        </button>
      </div>
    </div>
  )
}
