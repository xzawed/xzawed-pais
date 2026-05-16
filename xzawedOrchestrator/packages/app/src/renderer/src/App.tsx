import React, { useEffect } from 'react'
import { useAppStore } from './store/app.store.js'
import { checkHealth } from './lib/api.js'
import { Sidebar } from './components/Sidebar.js'
import { ChatView } from './components/ChatView.js'
import { DynamicPanel } from './components/DynamicPanel.js'
import { SettingsModal } from './components/SettingsModal.js'

export function App(): React.JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()

  // Load persisted settings from Electron main on first render
  useEffect(() => {
    window.electronAPI
      ?.getSettings()
      .then((saved) => {
        updateSettings(saved)
      })
      .catch(() => {
        // Running in browser dev mode without Electron — use defaults
      })
  }, [updateSettings])

  // Poll /health every 3 seconds
  useEffect(() => {
    let cancelled = false

    async function poll(): Promise<void> {
      if (cancelled) return
      const healthy = await checkHealth(settings.serverUrl)
      if (!cancelled) {
        setServerStatus(healthy ? 'running' : 'stopped')
      }
    }

    void poll()
    const id = setInterval(() => void poll(), 3000)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [settings.serverUrl])

  return (
    <div className="app-shell">
      <Sidebar />
      <ChatView />
      <DynamicPanel />
      <SettingsModal />
    </div>
  )
}
