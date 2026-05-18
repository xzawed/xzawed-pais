import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { LoginPage, RegisterPage, ProjectsPage, useAuthStore } from '@xzawed/ui'
import { useAppStore } from './store/app.store.js'
import { checkHealth } from './lib/api.js'
import { ChatLayout } from './components/ChatLayout.js'
import { SettingsModal } from './components/SettingsModal.js'
import { CommandPalette } from './components/CommandPalette.js'
import { TooltipProvider } from './components/ui/tooltip.js'
import { StatusBar } from './components/layout/StatusBar.js'

function RequireAuth({ children }: { children: React.ReactNode }): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RootRedirect(): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  return <Navigate to={user ? '/projects' : '/login'} replace />
}

export function App(): React.JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()
  const { restore } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    globalThis.electronAPI
      ?.getSettings()
      .then((saved) => updateSettings(saved))
      .catch(() => {})
  }, [updateSettings])

  useEffect(() => {
    if (settings.serverUrl) {
      void restore(settings.serverUrl)
    }
  }, [settings.serverUrl, restore])

  useEffect(() => {
    let cancelled = false
    async function poll(): Promise<void> {
      if (cancelled) return
      const healthy = await checkHealth(settings.serverUrl)
      if (!cancelled) setServerStatus(healthy ? 'running' : 'stopped')
    }
    void poll().catch((e: unknown) => console.error('[App] poll error:', e))
    const id = setInterval(() => {
      void poll().catch((e: unknown) => console.error('[App] poll error:', e))
    }, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [settings.serverUrl, setServerStatus])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
        <div className="flex flex-1 overflow-hidden min-w-0">
          <Routes>
            <Route path="/" element={<RootRedirect />} />

            <Route
              path="/login"
              element={
                <LoginPage
                  serverUrl={settings.serverUrl}
                  onSuccess={() => navigate('/projects')}
                  onRegister={() => navigate('/register')}
                />
              }
            />

            <Route
              path="/register"
              element={
                <RegisterPage
                  serverUrl={settings.serverUrl}
                  onSuccess={() => navigate('/projects')}
                  onLogin={() => navigate('/login')}
                />
              }
            />

            <Route
              path="/projects"
              element={
                <RequireAuth>
                  <ProjectsPage
                    serverUrl={settings.serverUrl}
                    onSelectProject={(id) => navigate(`/projects/${id}/chat`)}
                    onLogout={() => navigate('/login')}
                  />
                </RequireAuth>
              }
            />

            <Route
              path="/projects/:projectId/chat"
              element={
                <RequireAuth>
                  <ChatLayout />
                </RequireAuth>
              }
            />

            {/* Legacy/local mode: direct chat without auth */}
            <Route path="/chat" element={<ChatLayout />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        <StatusBar />
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
