import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api.js', () => ({
  createSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
  postMessage: vi.fn().mockResolvedValue(undefined),
  postUiAction: vi.fn().mockResolvedValue(undefined),
  getPendingDecisions: vi.fn().mockResolvedValue([]),
  submitDecision: vi.fn().mockResolvedValue(undefined),
  getKnowledge: vi.fn().mockResolvedValue([]),
  getDeletedKnowledge: vi.fn().mockResolvedValue([]),
  updateKnowledge: vi.fn().mockResolvedValue(undefined),
  deleteKnowledge: vi.fn().mockResolvedValue(undefined),
  restoreKnowledge: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi.fn().mockResolvedValue(true),
  SessionWsClient: vi.fn(function () { return { connect: vi.fn(() => () => {}), send: vi.fn() } }),
}))
// 세션 WS는 패널 렌더와 무관 — no-op으로 stub해 테스트를 단순화
vi.mock('../lib/useSessionWs.js', () => ({ useSessionWs: () => undefined }))

import { useIntegrationsStore } from '../store/integrations.store.js'
import { ChatLayout } from '../components/ChatLayout.js'
import { TooltipProvider } from '../components/ui/tooltip.js'

beforeEach(() => {
  useIntegrationsStore.setState({ activePanel: 'chat' })
})

describe('ChatLayout decisions 탭', () => {
  test('ActivityBar에 decisions 내비가 있고 클릭 시 DecisionsPanel 렌더', async () => {
    render(
      <MemoryRouter initialEntries={['/p/p1']}>
        <TooltipProvider>
          <ChatLayout />
        </TooltipProvider>
      </MemoryRouter>
    )
    const nav = screen.getByTestId('nav-decisions')
    expect(nav).toBeInTheDocument()
    fireEvent.click(nav)
    await waitFor(() => expect(screen.getByTestId('decisions-panel')).toBeInTheDocument())
  })
})
