import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { RegisterPage } from '../components/RegisterPage.js'

afterEach(cleanup)

const mockRegister = vi.fn().mockResolvedValue(undefined)

vi.mock('../stores/auth.store.js', () => ({
  useAuthStore: vi.fn(function () { return ({
    register: mockRegister,
    isLoading: false,
  }) }),
}))

const defaultProps = {
  serverUrl: 'http://localhost:3000',
  onSuccess: vi.fn(),
  onLogin: vi.fn(),
}

describe('RegisterPage', () => {
  it('이메일·패스워드·displayName·제출 버튼 렌더링', () => {
    render(<RegisterPage {...defaultProps} />)
    expect(screen.getByTestId('register-email')).toBeInTheDocument()
    expect(screen.getByTestId('register-password')).toBeInTheDocument()
    expect(screen.getByTestId('register-submit')).toBeInTheDocument()
    // Display name label text 확인 (FormField는 for 속성 없음 — getByText 사용)
    expect(screen.getByText('Display name')).toBeInTheDocument()
  })

  it('폼 제출 성공 시 onSuccess 콜백 호출', async () => {
    const onSuccess = vi.fn()
    mockRegister.mockResolvedValueOnce(undefined)
    render(<RegisterPage {...defaultProps} onSuccess={onSuccess} />)
    fireEvent.change(screen.getByTestId('register-email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'password123' } })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('register-submit').closest('form')!)
    })
    expect(mockRegister).toHaveBeenCalledWith('http://localhost:3000', 'new@example.com', 'password123', undefined)
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('폼 제출 실패 시 에러 메시지 표시', async () => {
    mockRegister.mockRejectedValueOnce(new Error('Email already in use'))
    render(<RegisterPage {...defaultProps} />)
    await act(async () => {
      fireEvent.submit(screen.getByTestId('register-submit').closest('form')!)
    })
    expect(screen.getByText('Email already in use')).toBeInTheDocument()
  })

  it('onLogin 링크 클릭 시 콜백 호출', () => {
    const onLogin = vi.fn()
    render(<RegisterPage {...defaultProps} onLogin={onLogin} />)
    fireEvent.click(screen.getByTestId('register-go-login'))
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('displayName 미입력 시 undefined로 register 호출', async () => {
    mockRegister.mockResolvedValueOnce(undefined)
    render(<RegisterPage {...defaultProps} />)
    fireEvent.change(screen.getByTestId('register-email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'securepass' } })
    // displayName 필드를 비워둠 (기본값 '')
    await act(async () => {
      fireEvent.submit(screen.getByTestId('register-submit').closest('form')!)
    })
    // '' || undefined → undefined
    expect(mockRegister).toHaveBeenCalledWith('http://localhost:3000', 'user@example.com', 'securepass', undefined)
  })

  it('displayName 입력 시 해당 값으로 register 호출', async () => {
    mockRegister.mockResolvedValueOnce(undefined)
    render(<RegisterPage {...defaultProps} />)
    // Display name input은 data-testid 없음 — 라벨 텍스트 기준으로 형제 input 접근
    const displayNameInput = screen.getByText('Display name').closest('div')!.querySelector('input')!
    fireEvent.change(displayNameInput, { target: { value: 'Alice' } })
    fireEvent.change(screen.getByTestId('register-email'), { target: { value: 'alice@example.com' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'password123' } })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('register-submit').closest('form')!)
    })
    expect(mockRegister).toHaveBeenCalledWith('http://localhost:3000', 'alice@example.com', 'password123', 'Alice')
  })

  it('isLoading=true 이면 제출 버튼 disabled', async () => {
    const { useAuthStore } = await import('../stores/auth.store.js')
    vi.mocked(useAuthStore).mockReturnValueOnce({
      register: mockRegister,
      isLoading: true,
    } as ReturnType<typeof useAuthStore>)
    render(<RegisterPage {...defaultProps} />)
    expect(screen.getByTestId('register-submit')).toBeDisabled()
  })
})
