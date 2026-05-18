import React, { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useAppStore } from './store/app.store.js'
import { useIntegrationsStore } from './store/integrations.store.js'
import { checkHealth } from './lib/api.js'
import { ActivityBar } from './components/layout/ActivityBar.js'
import { Sidebar } from './components/Sidebar.js'
import { RightPanel } from './components/layout/RightPanel.js'
import { ChatView } from './components/ChatView.js'
import { DynamicPanel } from './components/DynamicPanel.js'
import { SettingsModal } from './components/SettingsModal.js'
import { GitHubPanel } from './components/GitHubPanel.js'
import { McpPanel } from './components/McpPanel.js'
import { PluginPanel } from './components/PluginPanel.js'
import { CommandPalette } from './components/CommandPalette.js'
import { TooltipProvider } from './components/ui/tooltip.js'

export function App(): React.JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()
  const { activePanel } = useIntegrationsStore()

  useEffect(() => {
    window.electronAPI
      ?.getSettings()
      .then((saved) => updateSettings(saved))
      .catch(() => {})
  }, [updateSettings])

  useEffect(() => {
    let cancelled = false
    async function poll(): Promise<void> {
      if (cancelled) return
      const healthy = await checkHealth(settings.serverUrl)
      if (!cancelled) setServerStatus(healthy ? 'running' : 'stopped')
    }
    void poll()
    const id = setInterval(() => void poll(), 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [settings.serverUrl, setServerStatus])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full overflow-hidden bg-bg">

        {/* 1. Activity Bar (44px) */}
        <ActivityBar />

        {/* 2. Sidebar (210px) */}
        <Sidebar />

        {/* 3. Main Area (flex-1) */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {activePanel === 'chat' && (
            <div className="flex flex-1 overflow-hidden">
              <ChatView />
              <DynamicPanel />
            </div>
          )}
          {activePanel === 'github'  && <GitHubPanel />}
          {activePanel === 'mcp'     && <McpPanel />}
          {activePanel === 'plugins' && <PluginPanel />}
        </div>

        {/* 4. Right Panel (200px) — chat 패널에서만 표시 */}
        {activePanel === 'chat' && <RightPanel />}

        {/* Overlays */}
        <SettingsModal />
        <CommandPalette />
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-fg)',
              fontSize: '12px',
            },
          }}
        />
      </div>
    </TooltipProvider>
  )
}
