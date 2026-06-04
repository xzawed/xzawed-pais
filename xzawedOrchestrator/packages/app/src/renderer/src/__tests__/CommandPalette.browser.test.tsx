import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { CommandPalette } from '../components/CommandPalette.js'
import '../lib/i18n.js'

// framer-motion AnimatePresence를 동기 pass-through로 mock — 애니메이션 없이 즉시 언마운트
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      ...actual.motion,
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
        <div {...props}>{children}</div>
      ),
    },
  }
})

vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            command_palette: {
              placeholder: '명령어 검색...',
              new_session: '새 세션',
              settings: '설정',
              no_results: '결과 없음',
              session_group: '세션',
              navigate_group: '이동',
              nav_chat: '채팅으로 이동',
              nav_github: 'GitHub 패널',
              nav_mcp: 'MCP 서버 패널',
              nav_plugins: '플러그인 패널',
              other_group: '기타',
            },
          },
          common: {},
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
  createSession: vi.fn().mockResolvedValue({ sessionId: 'palette-session-id' }),
}))

describe('CommandPalette', () => {
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

  test('초기 상태에서 command-palette가 렌더링되지 않는다', () => {
    render(<CommandPalette />)
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  test('Ctrl+K 키 이벤트로 command-palette가 표시된다', () => {
    render(<CommandPalette />)
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.getByTestId('command-palette')).toBeInTheDocument()
  })

  test('열린 상태에서 command-palette-input이 렌더링된다', () => {
    render(<CommandPalette />)
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.getByTestId('command-palette-input')).toBeInTheDocument()
  })

  test('열린 상태에서 command-palette-item들이 렌더링된다', () => {
    render(<CommandPalette />)
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    const items = screen.getAllByTestId('command-palette-item')
    expect(items.length).toBeGreaterThan(0)
  })

  test('Escape 키로 command-palette가 닫힌다', () => {
    render(<CommandPalette />)
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.getByTestId('command-palette')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  test('Ctrl+K를 두 번 누르면 command-palette가 토글된다', () => {
    render(<CommandPalette />)
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.getByTestId('command-palette')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  test('오버레이 클릭으로 command-palette가 닫힌다', () => {
    render(<CommandPalette />)
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.getByTestId('command-palette')).toBeInTheDocument()
    // 오버레이(backdrop)는 command-palette의 형제 요소 — fixed inset-0 div
    const overlay = document.querySelector('.fixed.inset-0.z-40')
    expect(overlay).not.toBeNull()
    act(() => {
      fireEvent.click(overlay!)
    })
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })
})
