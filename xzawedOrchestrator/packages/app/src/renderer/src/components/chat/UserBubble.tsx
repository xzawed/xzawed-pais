import React from 'react'
import { motion } from 'framer-motion'
import type { Message } from '@xzawed/shared'

interface Props {
  message: Message
}

export function UserBubble({ message }: Props): React.JSX.Element {
  return (
    <motion.div
      className="flex justify-end"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div
        className="max-w-[60%] rounded-[10px_10px_2px_10px] bg-accent px-3.5 py-2 text-[12px] leading-relaxed text-white"
      >
        {message.content}
      </div>
    </motion.div>
  )
}
