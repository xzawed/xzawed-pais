import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { I18nextProvider } from 'react-i18next'
import { LoginPage, RegisterPage, ProjectsPage, useAuthStore } from '@xzawed/ui'
import { useAppStore } from './store/app.store.js'
import { checkHealth } from './lib/api.js'
import { ChatLayout } from './components/ChatLayout.js'
import { SettingsModal } from './components/SettingsModal.js'
import { CommandPalette } from './components/CommandPalette.js'
import { TooltipProvider } from './components/ui/tooltip.js'
import { StatusBar } from './components/layout/StatusBar.js'
import './lib/i18n.js'
import i18n from './lib/i18n.js'

function RequireAuth({ children, noAuth }: { children: React.ReactNode; noAuth: boolean }): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  if (!noAuth && !user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RootRedirect({ noAuth }: { noAuth: boolean }): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  if (noAuth) return <Navigate to="/chat" replace />
  return <Navigate to={user ? '/projects' : '/login'} replace />
}

export function App(): React.JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()
  const { restore } = useAuthStore()
  const navigate = useNavigate()
  const [noAuth, setNoAuth] = useState(false)

  useEffect(() => {
    globalThis.electronAPI
      ?.getSettings()
      .then((saved) => updateSettings(saved))
      .catch(() => {})
  }, [updateSettings])

  useEffect(() => {
    if (!settings.serverUrl) return
    restore(settings.serverUrl).catch((e: unknown) => console.error('[App] restore error:', e))
    // Probe whether auth routes exist; 404 means AUTH=none mode → go directly to chat
    fetch(`${settings.serverUrl}/auth/me`)
      .then((res) => {
        if (res.status === 404) {
          setNoAuth(true)
          navigate('/chat', { replace: true })
        }
      })
      .catch(() => {})
  }, [settings.serverUrl, restore, navigate])

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
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
          <div className="flex flex-1 overflow-hidden min-w-0">
            <Routes>
              <Route path="/" element={<RootRedirect noAuth={noAuth} />} />

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
                  <RequireAuth noAuth={noAuth}>
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
                  <RequireAuth noAuth={noAuth}>
                    <ChatLayout />
                  </RequireAuth>
                }
              />

              {/* Local/no-auth mode: direct chat */}
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
    </I18nextProvider>
  )
}
