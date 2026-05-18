import React, { useState, useRef, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'

interface Props {
  onSend: (content: string) => void
  disabled: boolean
}

export function MessageInput({ onSend, disabled }: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
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
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleInput(): void {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="border-t border-border bg-bg px-3 py-2.5">
      <motion.div
        className="flex items-end gap-2 rounded-lg border bg-surface px-3 py-2 transition-colors duration-200"
        animate={{
          borderColor: focused ? 'rgba(0, 120, 212, 0.6)' : 'var(--color-border)',
          boxShadow: focused ? '0 0 0 1px rgba(0, 120, 212, 0.2)' : 'none',
        }}
        transition={{ duration: 0.15 }}
      >
        <textarea
          ref={textareaRef}
          data-testid="message-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="메시지를 입력하세요..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-[12px] text-fg placeholder:text-fg-ghost outline-none disabled:opacity-50 max-h-[120px] leading-relaxed"
          style={{ minHeight: '20px' }}
        />
        <div className="flex items-center gap-2 flex-shrink-0 self-end pb-0.5">
          <span className="hidden sm:block text-[9px] text-fg-ghost">
            {disabled ? '' : 'Enter 전송 · Shift+Enter 줄바꿈'}
          </span>
          <motion.button
            aria-label="메시지 전송"
            data-testid="message-send-button"
            onClick={handleSend}
            disabled={!canSend}
            className="h-6 w-6 rounded flex items-center justify-center text-[11px] bg-accent text-white disabled:opacity-30 transition-colors"
            whileHover={canSend ? { scale: 1.05 } : {}}
            whileTap={canSend ? { scale: 0.95 } : {}}
          >
            ↑
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}
