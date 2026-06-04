import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { GitHubPanel } from '../components/GitHubPanel.js'
import '../lib/i18n.js'

vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (i18n.isInitialized) {
    i18n.addResourceBundle('ko', 'common', {
      back_to_chat: '← 채팅으로',
      loading: '로딩 중...',
    }, true, true)
    i18n.addResourceBundle('ko', 'app', {
      github: {
        title: 'GitHub',
        connect_hint: 'GitHub 계정을 연결하면 레포지토리를 관리할 수 있습니다.',
      },
    }, true, true)
  } else {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            github: {
              title: 'GitHub',
              connect_hint: 'GitHub 계정을 연결하면 레포지토리를 관리할 수 있습니다.',
            },
          },
          common: {
            back_to_chat: '← 채팅으로',
            loading: '로딩 중...',
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
    githubGetStatus: vi.fn().mockResolvedValue({ connected: false }),
    githubConnect: vi.fn().mockResolvedValue(null),
    githubDisconnect: vi.fn().mockResolvedValue(undefined),
    githubListRepos: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('GitHubPanel', () => {
  beforeEach(() => {
    useIntegrationsStore.setState({
      github: {
        connected: false,
        username: null,
        avatarUrl: null,
        defaultRepo: null,
        repos: [],
      },
    })
    vi.stubGlobal('electronAPI', makeElectronAPI())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('github-panel-title testid가 렌더링된다', async () => {
    render(<GitHubPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('github-panel-title')).toBeInTheDocument()
    })
  })

  test('GitHub 미연결 상태(connected=false)일 때 연결 버튼과 안내 문구가 표시된다', async () => {
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
    })
    render(<GitHubPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('github-connect-hint')).toBeInTheDocument()
      expect(screen.getByTestId('github-oauth-button')).toBeInTheDocument()
    })
  })

  test('GitHub 연결 상태(connected=true, repos 있음)일 때 레포 목록이 표시된다', async () => {
    vi.stubGlobal('electronAPI', makeElectronAPI({
      githubGetStatus: vi.fn().mockResolvedValue({ connected: false }),
    }))
    useIntegrationsStore.setState({
      github: {
        connected: true,
        username: 'xzawed',
        avatarUrl: null,
        defaultRepo: null,
        repos: [
          { id: 1, name: 'repo-a', fullName: 'xzawed/repo-a', private: false, defaultBranch: 'main' },
          { id: 2, name: 'repo-b', fullName: 'xzawed/repo-b', private: true, defaultBranch: 'main' },
        ],
      },
    })
    render(<GitHubPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('github-repo-list')).toBeInTheDocument()
      // repo-a는 select <option>과 repo-list <span> 두 곳에 나타나므로 getAllByText 사용
      expect(screen.getAllByText(/xzawed\/repo-a/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/xzawed\/repo-b/).length).toBeGreaterThanOrEqual(1)
    })
  })

  test('githubGetStatus가 connected=false를 반환하면 미연결 상태 UI가 표시된다', async () => {
    const mockGetStatus = vi.fn().mockResolvedValue({ connected: false })
    vi.stubGlobal('electronAPI', makeElectronAPI({ githubGetStatus: mockGetStatus }))
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
    })
    render(<GitHubPanel />)
    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalled()
      expect(screen.getByTestId('github-oauth-button')).toBeInTheDocument()
    })
  })

  test('연결 버튼 클릭 시 githubConnect가 호출된다', async () => {
    const mockConnect = vi.fn().mockResolvedValue({ username: 'xzawed', avatarUrl: 'https://example.com/avatar.png' })
    const mockListRepos = vi.fn().mockResolvedValue([])
    vi.stubGlobal('electronAPI', makeElectronAPI({
      githubConnect: mockConnect,
      githubListRepos: mockListRepos,
    }))
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
    })
    render(<GitHubPanel />)
    await waitFor(() => {
      expect(screen.getByTestId('github-oauth-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('github-oauth-button'))
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledOnce()
    })
  })
})
