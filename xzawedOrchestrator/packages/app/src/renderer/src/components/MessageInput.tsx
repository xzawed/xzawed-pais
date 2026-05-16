import React, { useState, useRef, type KeyboardEvent } from 'react'

interface Props {
  onSend: (content: string) => void
  disabled: boolean
}

export function MessageInput({ onSend, disabled }: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend(): void {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleInput(): void {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }

  return (
    <div className="message-input-bar">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        rows={1}
        disabled={disabled}
      />
      <button onClick={handleSend} disabled={disabled || !value.trim()}>
        Send
      </button>
    </div>
  )
}
