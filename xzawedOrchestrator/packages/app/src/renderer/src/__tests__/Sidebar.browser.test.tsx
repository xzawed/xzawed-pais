import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { Sidebar } from '../components/Sidebar.js'
import '../lib/i18n.js'

vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            sidebar: {
              new_session: '새 세션',
              search_placeholder: '세션 검색...',
              current_session: '현재 세션',
              today: '오늘',
              no_sessions: '세션이 없습니다',
              plugins_count: '플러그인 {{count}}',
            },
          },
          common: { loading: '로딩 중...' },
        },
      },
      lng: 'ko',
      fallbackLng: 'ko',
      defaultNS: 'app',
      ns: ['app', 'common'],
      interpolation: { escapeValue: false },
    })
  }
  return { default: i18n }
})

vi.mock('../lib/api.js', () => ({
  createSession: vi.fn().mockResolvedValue({ sessionId: 'new-session-id' }),
}))

describe('Sidebar', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { serverUrl: 'http://localhost:3000', mode: 'local', userId: 'user' },
      showSettings: false,
      serverStatus: 'unknown',
      locale: 'ko',
    })
    useChatStore.setState({
      sessionId: null,
      messages: [],
      streamingContent: '',
      streamingMsgId: null,
      isStreaming: false,
      isPending: false,
      uiSpec: null,
      logLines: [],
      tokenCount: 0,
      elapsedMs: 0,
      modifiedFiles: [],
    })
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
      mcp: { servers: [], statuses: {} },
      plugins: [],
      activePanel: 'chat',
      sidebarMode: 'auto',
    })
  })

  test('new-session-button이 렌더링된다', () => {
    render(<Sidebar />)
    expect(screen.getByTestId('new-session-button')).toBeInTheDocument()
  })

  test('검색 입력 필드가 렌더링된다', () => {
    render(<Sidebar />)
    const input = screen.getByPlaceholderText('세션 검색...')
    expect(input).toBeInTheDocument()
  })

  test('sessionId가 없을 때 session-list-item이 존재하지 않는다', () => {
    useChatStore.setState({ sessionId: null })
    render(<Sidebar />)
    expect(screen.queryAllByTestId('session-list-item')).toHaveLength(0)
  })

  test('sessionId가 있을 때 session-list-item이 렌더링된다', () => {
    useChatStore.setState({ sessionId: 'active-session-123' })
    render(<Sidebar />)
    expect(screen.getByTestId('session-list-item')).toBeInTheDocument()
  })

  test('GitHub 미연결 상태에서 GH 배지가 렌더링되지 않는다', () => {
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
    })
    render(<Sidebar />)
    expect(screen.queryByText(/● GH/)).not.toBeInTheDocument()
  })

  test('GitHub 연결 상태에서 GH 배지가 렌더링된다', () => {
    useIntegrationsStore.setState({
      github: { connected: true, username: 'testuser', avatarUrl: null, defaultRepo: null, repos: [] },
    })
    render(<Sidebar />)
    expect(screen.getByText(/● GH/)).toBeInTheDocument()
  })

  test('MCP 서버가 있을 때 MCP 배지가 렌더링된다', () => {
    useIntegrationsStore.setState({
      mcp: {
        servers: [{ id: 's1', name: 'Test', command: 'node', args: [], autoStart: false }],
        statuses: {},
      },
    })
    render(<Sidebar />)
    expect(screen.getByText(/MCP 1/)).toBeInTheDocument()
  })
})
