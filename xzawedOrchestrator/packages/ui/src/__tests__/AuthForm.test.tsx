import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FormError, SubmitButton, FormField, AuthCard } from '../components/AuthForm.js'

afterEach(cleanup)

describe('FormError', () => {
  it('message=null 이면 아무것도 렌더링하지 않음', () => {
    const { container } = render(<FormError message={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('message 있으면 텍스트 표시', () => {
    render(<FormError message="Something went wrong" data-testid="form-error" />)
    expect(screen.getByTestId('form-error')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('data-testid prop이 없어도 message 텍스트 표시', () => {
    render(<FormError message="Error without testid" />)
    expect(screen.getByText('Error without testid')).toBeInTheDocument()
  })
})

describe('SubmitButton', () => {
  it('isLoading=true 이면 loadingLabel 표시 및 disabled', () => {
    render(
      <SubmitButton
        isLoading={true}
        label="Submit"
        loadingLabel="Loading..."
        data-testid="submit-btn"
      />,
    )
    const btn = screen.getByTestId('submit-btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Loading...')
  })

  it('isLoading=false 이면 label 표시 및 enabled', () => {
    render(
      <SubmitButton
        isLoading={false}
        label="Submit"
        loadingLabel="Loading..."
        data-testid="submit-btn"
      />,
    )
    const btn = screen.getByTestId('submit-btn')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveTextContent('Submit')
  })

  it('type="submit" 속성 확인', () => {
    render(<SubmitButton isLoading={false} label="Go" loadingLabel="..." />)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit')
  })
})

describe('FormField', () => {
  it('onChange 콜백 호출', () => {
    const onChange = vi.fn()
    render(
      <FormField
        label="Email"
        type="email"
        value=""
        onChange={onChange}
        data-testid="field-input"
      />,
    )
    fireEvent.change(screen.getByTestId('field-input'), { target: { value: 'hello@example.com' } })
    expect(onChange).toHaveBeenCalledWith('hello@example.com')
  })

  it('label 텍스트 렌더링 확인', () => {
    render(<FormField label="My Label" type="text" value="" onChange={vi.fn()} />)
    expect(screen.getByText('My Label')).toBeInTheDocument()
  })

  it('required prop 전달 시 input에 required 속성 적용', () => {
    render(
      <FormField
        label="Email"
        type="email"
        value=""
        onChange={vi.fn()}
        required
        data-testid="required-input"
      />,
    )
    expect(screen.getByTestId('required-input')).toBeRequired()
  })
})

describe('AuthCard', () => {
  it('title과 subtitle 렌더링', () => {
    render(
      <AuthCard title="Sign In" subtitle="xzawed PAIS">
        <span>child content</span>
      </AuthCard>,
    )
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.getByText('xzawed PAIS')).toBeInTheDocument()
    expect(screen.getByText('child content')).toBeInTheDocument()
  })
})
