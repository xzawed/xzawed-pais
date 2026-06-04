import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@xzawed/ui'
import { useAppStore } from '../store/app.store.js'
import { App } from '../App.js'

// 실제 restore 액션 참조 — isRestoring 가드 테스트가 restore를 no-op로 덮으므로,
// 각 테스트 전(beforeEach)에 원본으로 복원해 테스트 간 누수를 방지한다.
const ORIGINAL_RESTORE = useAuthStore.getState().restore

// i18n mock — 실제 locale JSON 없이 동작
vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            settings: { title: '설정' },
            command_palette: { placeholder: '명령어 검색...', new_session: '새 세션', settings: '설정' },
            sidebar: { new_session: '새 세션', search_placeholder: '', current_session: '', today: '' },
            chat: { empty_state: '새 세션을 시작해주세요', input_placeholder: '', send_hint: '' },
          },
          common: { save: '저장', cancel: '취소' },
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

// API mock — 실제 HTTP 요청 차단
vi.mock('../lib/api.js', () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  createSession: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
  postMessage: vi.fn(),
  SessionWsClient: vi.fn(function () { return ({ connect: vi.fn(() => () => {}) }) }),
}))

// @xzawed/ui 페이지 컴포넌트만 stub — useAuthStore는 실제 모듈 사용
vi.mock('@xzawed/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xzawed/ui')>()
  return {
    ...actual,
    LoginPage: () => <div data-testid="login-page">Login Page</div>,
    RegisterPage: () => <div data-testid="register-page">Register Page</div>,
    ProjectsPage: () => <div data-testid="projects-page">Projects Page</div>,
  }
})

// ChatLayout mock — 무거운 서브 컴포넌트 제거
vi.mock('../components/ChatLayout.js', () => ({
  ChatLayout: () => <div data-testid="chat-layout">Chat Layout</div>,
}))

// electronAPI stub
vi.stubGlobal('electronAPI', {
  getSettings: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:3000', mode: 'local', userId: 'user' }),
  setSettings: vi.fn().mockResolvedValue(undefined),
  authRestore: vi.fn().mockResolvedValue({ user: null }),
})

function renderApp(initialPath: string = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  )
}

describe('App', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { serverUrl: 'http://localhost:3000', mode: 'local', userId: 'user' },
      showSettings: false,
      serverStatus: 'unknown',
      locale: 'ko',
    })
    useAuthStore.setState({ user: null, accessToken: null, isLoading: false, isRestoring: false, restore: ORIGINAL_RESTORE })
    // fetch('/auth/me') mock: status 200 → noAuth=false, authChecked=true (인증 모드)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('/ 경로에서 user가 없으면 /login으로 리다이렉트된다', async () => {
    useAuthStore.setState({ user: null })
    renderApp('/')
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  test('/ 경로에서 user가 있으면 /projects로 리다이렉트된다', async () => {
    useAuthStore.setState({ user: { id: '1', email: 'test@example.com' } })
    renderApp('/')
    expect(await screen.findByTestId('projects-page')).toBeInTheDocument()
  })

  test('/login 경로에서 LoginPage가 렌더링된다', () => {
    renderApp('/login')
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  test('/register 경로에서 RegisterPage가 렌더링된다', () => {
    renderApp('/register')
    expect(screen.getByTestId('register-page')).toBeInTheDocument()
  })

  test('/projects 경로에서 user가 없으면 /login으로 리다이렉트된다', async () => {
    useAuthStore.setState({ user: null })
    renderApp('/projects')
    // isRestoring 가드 때문에 restore 정착 후 리다이렉트 — 비동기 대기
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  test('/projects 경로에서 user가 있으면 ProjectsPage가 렌더링된다', async () => {
    useAuthStore.setState({ user: { id: '1', email: 'test@example.com' } })
    renderApp('/projects')
    expect(await screen.findByTestId('projects-page')).toBeInTheDocument()
  })

  test('/chat 경로에서 인증 없이 ChatLayout이 렌더링된다', () => {
    useAuthStore.setState({ user: null })
    renderApp('/chat')
    expect(screen.getByTestId('chat-layout')).toBeInTheDocument()
  })

  // restore를 no-op로 덮어 isRestoring=true가 첫 렌더부터 유지되게 한다 — 앱이 restore()를
  // 호출해도 리셋되지 않아, isRestoring 가드가 리다이렉트를 보류하는지 결정적으로 검증한다.
  test('restore 진행 중(isRestoring)이면 / 경로에서 리다이렉트를 보류한다', async () => {
    useAuthStore.setState({ user: null, isRestoring: true, restore: async () => { /* hold */ } })
    renderApp('/')
    await new Promise((r) => setTimeout(r, 30))
    expect(useAuthStore.getState().isRestoring).toBe(true)
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('projects-page')).not.toBeInTheDocument()
  })

  test('restore 진행 중(isRestoring)이면 /projects에서 RequireAuth가 리다이렉트를 보류한다', async () => {
    useAuthStore.setState({ user: null, isRestoring: true, restore: async () => { /* hold */ } })
    renderApp('/projects')
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('projects-page')).not.toBeInTheDocument()
  })
})
