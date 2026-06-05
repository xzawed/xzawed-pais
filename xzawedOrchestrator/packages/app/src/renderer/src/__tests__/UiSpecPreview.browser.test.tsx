import React from 'react'
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UISpec } from '@xzawed/shared'
import { UiSpecPreview } from '../components/chat/UiSpecPreview.js'
import '../lib/i18n.js'

describe('UiSpecPreview', () => {
  test('form fields를 비활성 입력으로 렌더한다(label·option 유지)', () => {
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
    const inputs = screen.getByTestId('uispec-fields').querySelectorAll('input,select')
    expect(inputs.length).toBeGreaterThan(0)
    inputs.forEach((el) => expect(el).toBeDisabled())
  })

  test('mockup_viewer content를 마크다운으로 렌더한다', () => {
    const spec: UISpec = { type: 'mockup_viewer', title: 'Mockup', content: '## 로그인 페이지\n\n- 이메일 입력' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByRole('heading', { name: '로그인 페이지' })).toBeInTheDocument()
    expect(screen.getByText('이메일 입력')).toBeInTheDocument()
  })

  test('알려진 컴포넌트를 실제 styled 엘리먼트로 렌더한다', () => {
    const spec: UISpec = {
      type: 'mockup_viewer',
      title: 'Login',
      components: [
        {
          name: 'Card',
          description: 'auth',
          props: { title: '로그인' },
          children: [
            { name: 'Input', description: 'email', props: { label: '이메일', placeholder: 'you@x.com' } },
            { name: 'Button', description: 'submit', props: { label: '로그인', variant: 'primary' } },
          ],
        },
      ],
    }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByTestId('uispec-components')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: '로그인' })
    expect(btn).toBeDisabled()
    const emailInput = screen.getByPlaceholderText('you@x.com')
    expect(emailInput.tagName.toLowerCase()).toBe('input')
    expect(emailInput).toBeDisabled()
  })

  test('미지원 컴포넌트 이름은 폴백 박스(name·description)로 degrade한다', () => {
    const spec: UISpec = {
      type: 'mockup_viewer',
      components: [{ name: 'FancyWidget', description: '커스텀 위젯', props: {} }],
    }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByText('FancyWidget')).toBeInTheDocument()
    expect(screen.getByText('커스텀 위젯')).toBeInTheDocument()
  })

  test('components가 없으면 컴포넌트 트리를 렌더하지 않는다', () => {
    const spec: UISpec = { type: 'mockup_viewer', title: 'M', content: '## x' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.queryByTestId('uispec-components')).not.toBeInTheDocument()
  })

  test('표시할 내용이 없으면 빈 안내를 보여 준다', () => {
    const spec: UISpec = { type: 'mockup_viewer', title: 'Empty' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByTestId('uispec-empty')).toBeInTheDocument()
  })
})
