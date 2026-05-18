import React from 'react'
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeBlock } from '../components/chat/CodeBlock.js'

describe('CodeBlock', () => {
  test('renders copy button with data-testid', () => {
    render(<CodeBlock code="const x = 1" lang="typescript" />)
    expect(screen.getByTestId('code-copy-button')).toBeInTheDocument()
  })

  test('copy button shows 복사 text by default', () => {
    render(<CodeBlock code="console.log('hello')" lang="javascript" />)
    expect(screen.getByTestId('code-copy-button')).toHaveTextContent('복사')
  })

  test('renders code content as fallback before highlighting', () => {
    render(<CodeBlock code="export default {}" lang="json" />)
    expect(screen.getByTestId('code-copy-button')).toBeInTheDocument()
  })
})
