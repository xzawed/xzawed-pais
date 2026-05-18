import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { LoginPage, RegisterPage, ProjectsPage, useAuthStore } from '@xzawed/ui'
import { WebChatView } from './WebChatView.js'

const SERVER_URL = window.location.origin

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
  const { restore } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    void restore(SERVER_URL)
  }, [restore])

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route
        path="/login"
        element={
          <LoginPage
            serverUrl={SERVER_URL}
            onSuccess={() => navigate('/projects')}
            onRegister={() => navigate('/register')}
          />
        }
      />

      <Route
        path="/register"
        element={
          <RegisterPage
            serverUrl={SERVER_URL}
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
              serverUrl={SERVER_URL}
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
            <WebChatView serverUrl={SERVER_URL} />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
