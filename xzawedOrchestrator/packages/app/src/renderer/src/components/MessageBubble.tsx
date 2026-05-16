import React from 'react'
import type { Message } from '@xzawed/shared'

interface Props {
  message: Message
  streaming?: boolean
}

export function MessageBubble({ message, streaming = false }: Props): React.JSX.Element {
  const classes = [
    'message-bubble',
    message.role,
    streaming ? 'streaming' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {message.content}
      {streaming && <span style={{ opacity: 0.5 }}>▍</span>}
    </div>
  )
}
