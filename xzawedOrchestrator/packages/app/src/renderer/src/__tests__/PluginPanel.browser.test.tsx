import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { PluginPanel } from '../components/PluginPanel.js'
import type { PluginInfo } from '../store/integrations.store.js'

vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (i18n.isInitialized) {
    i18n.addResourceBundle('ko', 'common', {
      back_to_chat: '← 채팅으로',
    }, true, true)
    i18n.addResourceBundle('ko', 'app', {
      plugins: {
        title: '플러그인',
        search_placeholder: '플러그인 검색...',
      },
    }, true, true)
  } else {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            plugins: {
              title: '플러그인',
              search_placeholder: '플러그인 검색...',
            },
          },
          common: {
            back_to_chat: '← 채팅으로',
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

const SAMPLE_PLUGINS: PluginInfo[] = [
  {
    id: 'figma-plugin',
    name: 'Figma Plugin',
    version: '1.0.0',
    description: 'Figma 디자인 연동',
    type: 'claude-code',
    enabled: true,
  },
  {
    id: 'xzawed-extra',
    name: 'xzawed Extra',
    version: '0.5.0',
    description: 'xzawed 확장 기능',
    type: 'xzawed',
    enabled: false,
  },
]

function makeElectronAPI(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pluginList: vi.fn().mockResolvedValue([]),
    pluginToggle: vi.fn().mockResolvedValue(undefined),
    pluginUninstall: vi.fn().mockResolvedValue(undefined),
    pluginInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('PluginPanel', () => {
  beforeEach(() => {
    useIntegrationsStore.setState({ plugins: [] })
    vi.stubGlobal('electronAPI', makeElectronAPI())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('plugin-panel testid가 렌더링된다', async () => {
    render(<PluginPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('plugin-panel')).toBeInTheDocument()
    })
  })

  test('플러그인 목록이 없을 때 빈 상태 메시지가 표시된다', async () => {
    useIntegrationsStore.setState({ plugins: [] })
    render(<PluginPanel />)
    await waitFor(() => {
      expect(screen.getByText('설치된 플러그인이 없습니다.')).toBeInTheDocument()
    })
  })

  test('플러그인 목록이 있을 때 플러그인 이름이 렌더링된다', async () => {
    // pluginList mock이 SAMPLE_PLUGINS를 반환해야 useEffect가 store를 덮어쓰지 않는다
    vi.stubGlobal('electronAPI', makeElectronAPI({
      pluginList: vi.fn().mockResolvedValue(SAMPLE_PLUGINS),
    }))
    render(<PluginPanel />)
    await waitFor(() => {
      expect(screen.getByText('Figma Plugin')).toBeInTheDocument()
      expect(screen.getByText('xzawed Extra')).toBeInTheDocument()
    })
  })

  test('플러그인 활성화/비활성화 토글 버튼이 존재한다', async () => {
    vi.stubGlobal('electronAPI', makeElectronAPI({
      pluginList: vi.fn().mockResolvedValue(SAMPLE_PLUGINS),
    }))
    render(<PluginPanel />)
    await waitFor(() => {
      // enabled=true인 플러그인 → "비활성화" 버튼
      expect(screen.getByText('비활성화')).toBeInTheDocument()
      // enabled=false인 플러그인 → "활성화" 버튼
      expect(screen.getByText('활성화')).toBeInTheDocument()
    })
  })

  test('pluginList가 마운트 시 호출된다', async () => {
    const mockPluginList = vi.fn().mockResolvedValue([])
    vi.stubGlobal('electronAPI', makeElectronAPI({ pluginList: mockPluginList }))
    render(<PluginPanel />)
    await waitFor(() => {
      expect(mockPluginList).toHaveBeenCalledOnce()
    })
  })

  test('토글 버튼 클릭 시 pluginToggle이 호출된다', async () => {
    const mockToggle = vi.fn().mockResolvedValue(undefined)
    // pluginList도 SAMPLE_PLUGINS[0]을 반환해야 useEffect가 setState를 덮어쓰지 않는다
    vi.stubGlobal('electronAPI', makeElectronAPI({
      pluginToggle: mockToggle,
      pluginList: vi.fn().mockResolvedValue([SAMPLE_PLUGINS[0]]),
    }))
    render(<PluginPanel />)
    await waitFor(() => {
      expect(screen.getByText('비활성화')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('비활성화'))
    await waitFor(() => {
      expect(mockToggle).toHaveBeenCalledWith('figma-plugin')
    })
  })

  test('검색창에 입력 시 해당 플러그인만 필터링된다', async () => {
    vi.stubGlobal('electronAPI', makeElectronAPI({
      pluginList: vi.fn().mockResolvedValue(SAMPLE_PLUGINS),
    }))
    render(<PluginPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('plugin-search')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('plugin-search'), { target: { value: 'Figma' } })
    await waitFor(() => {
      expect(screen.getByText('Figma Plugin')).toBeInTheDocument()
      expect(screen.queryByText('xzawed Extra')).not.toBeInTheDocument()
    })
  })
})
