import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './styles/globals.css'
import { App } from './App.js'

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

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  </StrictMode>
)
