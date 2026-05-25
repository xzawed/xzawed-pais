import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './styles/globals.css'
import { App } from './App.js'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

const initialPath = globalThis.location?.hash === '#test' ? '/chat' : '/'

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  </StrictMode>
)
