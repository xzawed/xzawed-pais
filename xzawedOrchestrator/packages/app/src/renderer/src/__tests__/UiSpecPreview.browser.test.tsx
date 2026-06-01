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

  test('renders mockup_viewer content', () => {
    const spec: UISpec = { type: 'mockup_viewer', title: 'Mockup', content: '+---+\n| A |\n+---+' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByText(/\| A \|/)).toBeInTheDocument()
  })

  test('renders progress_board content', () => {
    const spec: UISpec = { type: 'progress_board', content: '3/5 완료' }
    render(<UiSpecPreview spec={spec} />)
    expect(screen.getByText(/3\/5 완료/)).toBeInTheDocument()
  })
})
