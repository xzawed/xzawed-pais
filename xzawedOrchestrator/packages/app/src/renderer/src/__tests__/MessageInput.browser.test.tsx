import React from 'react'
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageInput } from '../components/MessageInput.js'

describe('MessageInput', () => {
  test('renders textarea with data-testid', () => {
    render(<MessageInput onSend={() => {}} disabled={false} />)
    expect(screen.getByTestId('message-input')).toBeInTheDocument()
  })

  test('send button is disabled when textarea is empty', () => {
    render(<MessageInput onSend={() => {}} disabled={false} />)
    expect(screen.getByTestId('message-send-button')).toBeDisabled()
  })

  test('send button is disabled when component is disabled', () => {
    render(<MessageInput onSend={() => {}} disabled={true} />)
    expect(screen.getByTestId('message-send-button')).toBeDisabled()
  })
})
