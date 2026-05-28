import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { McpPanel } from '../components/McpPanel.js'

vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (i18n.isInitialized) {
    // i18n이 이미 초기화된 경우 필요한 리소스를 동적으로 추가한다
    i18n.addResourceBundle('ko', 'common', {
      back_to_chat: '← 채팅으로',
      start: '시작',
      stop: '중지',
      remove: '제거',
      install: '+ 설치',
      installing: '설치 중...',
      installed: '✓ 설치됨',
    }, true, true)
    i18n.addResourceBundle('ko', 'app', {
      mcp: {
        title: '🔌 MCP 서버',
        tab_installed: '설치됨 ({{count}})',
        tab_recommended: '추천 서버',
        tab_custom: '직접 추가',
        no_servers: '설치된 MCP 서버가 없습니다. "추천 서버" 탭에서 설치하세요.',
        btn_add_start: '+ 추가 및 시작',
        toggle_loading: '...',
      },
    }, true, true)
  } else {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            mcp: {
              title: '🔌 MCP 서버',
              tab_installed: '설치됨 ({{count}})',
              tab_recommended: '추천 서버',
              tab_custom: '직접 추가',
              no_servers: '설치된 MCP 서버가 없습니다. "추천 서버" 탭에서 설치하세요.',
              field_name: '이름',
              field_command: '실행 명령어',
              field_args: '인수 (공백 구분)',
              field_env: '환경변수 (JSON)',
              placeholder_name: '예: my-custom-mcp',
              placeholder_command: '예: npx',
              placeholder_args: '공백으로 구분',
              placeholder_env: '예: {"API_KEY": "sk-..."}',
              btn_add_start: '+ 추가 및 시작',
              toggle_loading: '...',
            },
          },
          common: {
            back_to_chat: '← 채팅으로',
            start: '시작',
            stop: '중지',
            remove: '제거',
            install: '+ 설치',
            installing: '설치 중...',
            installed: '✓ 설치됨',
          },
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

function makeElectronAPI(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mcpList: vi.fn().mockResolvedValue([]),
    mcpStatuses: vi.fn().mockResolvedValue({}),
    mcpAdd: vi.fn().mockResolvedValue(undefined),
    mcpRemove: vi.fn().mockResolvedValue(undefined),
    mcpStart: vi.fn().mockResolvedValue(undefined),
    mcpStop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('McpPanel', () => {
  beforeEach(() => {
    useIntegrationsStore.setState({
      mcp: { servers: [], statuses: {} },
    })
    vi.stubGlobal('electronAPI', makeElectronAPI())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('mcp-title testid가 렌더링된다', async () => {
    render(<McpPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('mcp-title')).toBeInTheDocument()
    })
  })

  test('MCP 서버가 없을 때 빈 상태 메시지가 표시된다', async () => {
    useIntegrationsStore.setState({ mcp: { servers: [], statuses: {} } })
    render(<McpPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('mcp-empty-message')).toBeInTheDocument()
    })
  })

  test('MCP 서버 목록이 있을 때 서버 이름이 렌더링된다', async () => {
    const servers = [
      { id: 'context7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], autoStart: true },
      { id: 'playwright', name: 'playwright', command: 'npx', args: ['@playwright/mcp@latest'], autoStart: true },
    ]
    // mcpList mock이 서버 목록을 반환해야 useEffect가 store를 빈 배열로 덮어쓰지 않는다
    vi.stubGlobal('electronAPI', makeElectronAPI({
      mcpList: vi.fn().mockResolvedValue(servers),
      mcpStatuses: vi.fn().mockResolvedValue({ context7: 'running', playwright: 'stopped' }),
    }))
    render(<McpPanel />)
    await waitFor(() => {
      expect(screen.getByText('context7')).toBeInTheDocument()
      expect(screen.getByText('playwright')).toBeInTheDocument()
    })
  })

  test('mcpList와 mcpStatuses가 마운트 시 호출된다', async () => {
    const mockMcpList = vi.fn().mockResolvedValue([])
    const mockMcpStatuses = vi.fn().mockResolvedValue({})
    vi.stubGlobal('electronAPI', makeElectronAPI({
      mcpList: mockMcpList,
      mcpStatuses: mockMcpStatuses,
    }))
    render(<McpPanel />)
    await waitFor(() => {
      expect(mockMcpList).toHaveBeenCalledOnce()
      expect(mockMcpStatuses).toHaveBeenCalledOnce()
    })
  })

  test('추천 서버 탭 클릭 시 추천 서버 목록이 표시된다', async () => {
    render(<McpPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('mcp-tab-recommended')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('mcp-tab-recommended'))
    await waitFor(() => {
      const items = screen.getAllByTestId('mcp-recommended-item')
      expect(items.length).toBeGreaterThan(0)
    })
  })

  test('서버 있을 때 서버 행에 토글/제거 버튼이 렌더링된다', async () => {
    const servers = [
      { id: 'context7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], autoStart: true },
    ]
    vi.stubGlobal('electronAPI', makeElectronAPI({
      mcpList: vi.fn().mockResolvedValue(servers),
      mcpStatuses: vi.fn().mockResolvedValue({ context7: 'stopped' }),
    }))
    render(<McpPanel />)
    await waitFor(() => {
      expect(screen.getByText('context7')).toBeInTheDocument()
    })
    // installed 탭에서 서버 행의 버튼(토글+제거) 2개가 존재해야 한다
    // Button 컴포넌트는 <button> 엘리먼트로 렌더링된다
    const buttons = screen.getAllByRole('button')
    // 탭 3개(installed/recommended/custom) + 뒤로가기 1개 + 서버 행 버튼 2개 = 6개
    expect(buttons.length).toBeGreaterThanOrEqual(6)
  })
})
