import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './styles/globals.css'
import { App } from './App.js'
import { useIntegrationsStore } from './store/integrations.store.js'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

function resolveInitialPath(): string {
  const hash = globalThis.location?.hash
  if (hash === '#test') return '/chat'
  if (hash === '#test-login') return '/login'
  if (hash === '#test-projects') return '/projects'
  return '/'
}
const initialPath = resolveInitialPath()

// E2E 테스트 모드에서 Zustand 스토어를 window에 노출 (IPC 없이 상태 직접 조작)
if (globalThis.location?.hash?.startsWith('#test')) {
  Object.assign(window, { __integrationsStore: useIntegrationsStore })
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  </StrictMode>
)
