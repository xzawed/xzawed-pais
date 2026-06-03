import React from 'react'
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UISpec } from '@xzawed/shared'
import { UiSpecPreview } from '../components/chat/UiSpecPreview.js'

describe('UiSpecPreview', () => {
  test('renders form fields with labels and types', () => {
    const spec: UISpec = {
      type: 'form',
      title: '로그인 폼',
      fields: [
        { id: 'email', type: 'text', label: '이메일', required: true },
        { id: 'role', type: 'select', label: '역할', options: [{ value: 'a', label: '관리자' }] },
      ],
    }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByTestId('uispec-preview')).toBeInTheDocument()
    expect(screen.getByText(/로그인 폼/)).toBeInTheDocument()
    expect(screen.getByText(/이메일/)).toBeInTheDocument()
    expect(screen.getByText(/관리자/)).toBeInTheDocument()
  })

  test('renders mockup_viewer content as rich markdown (heading + list)', () => {
    const spec: UISpec = {
      type: 'mockup_viewer',
      title: 'Mockup',
      content: '## 로그인 페이지\n\n- 이메일 입력\n- 비밀번호 입력',
    }
    render(<UiSpecPreview spec={spec} />)
    // 마크다운 구조가 실제 요소로 렌더된다(raw <pre> 텍스트가 아님)
    expect(screen.getByRole('heading', { name: '로그인 페이지' })).toBeInTheDocument()
    expect(screen.getByText('이메일 입력')).toBeInTheDocument()
    expect(screen.getByText('비밀번호 입력')).toBeInTheDocument()
  })

  test('renders progress_board content as markdown (emphasis)', () => {
    const spec: UISpec = { type: 'progress_board', content: '**3/5** 완료' }
    render(<UiSpecPreview spec={spec} />)
    const strong = screen.getByText('3/5')
    expect(strong.tagName.toLowerCase()).toBe('strong')
  })

  test('renders empty mockup content without crashing', () => {
    const spec: UISpec = { type: 'mockup_viewer', title: 'Empty' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByTestId('uispec-preview')).toBeInTheDocument()
  })

  test('components 트리를 중첩 박스 와이어프레임으로 재귀 렌더한다', () => {
    const spec: UISpec = {
      type: 'mockup_viewer',
      title: 'Login Page',
      content: '## Login',
      components: [
        {
          name: 'LoginForm',
          description: 'auth form',
          cssClasses: ['form', 'login-form'],
          children: [
            { name: 'EmailInput', description: 'email field', cssClasses: ['input'] },
            { name: 'PasswordInput', description: 'password field' },
          ],
        },
      ],
    }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByTestId('uispec-components')).toBeInTheDocument()
    // 부모·자식 컴포넌트 이름이 모두 렌더(재귀)
    expect(screen.getByText('LoginForm')).toBeInTheDocument()
    expect(screen.getByText('EmailInput')).toBeInTheDocument()
    expect(screen.getByText('PasswordInput')).toBeInTheDocument()
    // cssClasses 시각 힌트
    expect(screen.getByText('.form.login-form')).toBeInTheDocument()
    // description도 표시
    expect(screen.getByText('email field')).toBeInTheDocument()
  })

  test('components가 없으면 컴포넌트 트리를 렌더하지 않는다', () => {
    const spec: UISpec = { type: 'mockup_viewer', title: 'M', content: '## x' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.queryByTestId('uispec-components')).not.toBeInTheDocument()
  })
})
