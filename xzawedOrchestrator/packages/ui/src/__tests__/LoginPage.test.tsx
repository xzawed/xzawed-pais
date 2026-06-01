import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { LoginPage } from '../components/LoginPage.js'

afterEach(cleanup)

const mockLogin = vi.fn().mockResolvedValue(undefined)

vi.mock('../stores/auth.store.js', () => ({
  useAuthStore: vi.fn(function () { return ({
    login: mockLogin,
    isLoading: false,
  }) }),
}))

const defaultProps = {
  serverUrl: 'http://localhost:3000',
  onSuccess: vi.fn(),
  onRegister: vi.fn(),
}

describe('LoginPage', () => {
  it('이메일·패스워드·제출 버튼 렌더링', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByTestId('login-email')).toBeInTheDocument()
    expect(screen.getByTestId('login-password')).toBeInTheDocument()
    expect(screen.getByTestId('login-submit')).toBeInTheDocument()
  })

  it('폼 제출 성공 시 onSuccess 콜백 호출', async () => {
    const onSuccess = vi.fn()
    mockLogin.mockResolvedValueOnce(undefined)
    render(<LoginPage {...defaultProps} onSuccess={onSuccess} />)
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'password123' } })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('login-submit').closest('form')!)
    })
    expect(mockLogin).toHaveBeenCalledWith('http://localhost:3000', 'test@example.com', 'password123')
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('폼 제출 실패(Error 객체) 시 에러 메시지 표시', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid email or password'))
    render(<LoginPage {...defaultProps} />)
    await act(async () => {
      fireEvent.submit(screen.getByTestId('login-submit').closest('form')!)
    })
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument()
  })

  it('onRegister 링크 클릭 시 콜백 호출', () => {
    const onRegister = vi.fn()
    render(<LoginPage {...defaultProps} onRegister={onRegister} />)
    fireEvent.click(screen.getByTestId('login-go-register'))
    expect(onRegister).toHaveBeenCalledOnce()
  })

  it('isLoading=true 이면 제출 버튼 disabled', async () => {
    const { useAuthStore } = await import('../stores/auth.store.js')
    vi.mocked(useAuthStore).mockReturnValueOnce({
      login: mockLogin,
      isLoading: true,
    } as ReturnType<typeof useAuthStore>)
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByTestId('login-submit')).toBeDisabled()
  })

  it('title "Sign In" 렌더링 확인', () => {
    render(<LoginPage {...defaultProps} />)
    // i18n 초기화됨 — t('login.title') === 'Sign In'
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })
})
