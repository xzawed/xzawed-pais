import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useChatStore } from '../../store/chat.store.js'
import { cn } from '../../lib/utils.js'

const AGENT_COLORS: Record<string, string> = {
  MGR: 'text-agent-mgr',
  PLN: 'text-agent-planner',
  DEV: 'text-agent-dev',
  TST: 'text-agent-tester',
  BLD: 'text-agent-builder',
  WCH: 'text-agent-watcher',
  SCR: 'text-agent-security',
  DES: 'text-agent-designer',
}

function getLineColor(line: string): string {
  const match = line.match(/^\[([A-Z]{2,3})\]/)
  if (match) return AGENT_COLORS[match[1]] ?? 'text-fg-dim'
  return 'text-fg-ghost'
}

export function RightPanel({ style }: Readonly<{ style?: React.CSSProperties }>): React.JSX.Element {
  const { t } = useTranslation('app')
  const { logLines, tokenCount, sessionCostUsd, elapsedMs, modifiedFiles, isStreaming } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines])

  const elapsedSec = Math.floor(elapsedMs / 1000)
  const elapsedStr = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-shrink-0 flex-col border-l border-border bg-bg overflow-hidden" style={style}>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        {isStreaming && (
          <div className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse-glow-green" />
        )}
        <span className="text-[9px] uppercase tracking-wide text-fg-ghost">{t('right_panel.output_title')}</span>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0 space-y-0.5">
        {logLines.length === 0 && (
          <p className="text-[9px] text-fg-ghost italic">{t('right_panel.waiting')}</p>
        )}
        {logLines.map((line, i) => (
          <motion.div
            key={`${i}:${line}`}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('font-mono text-[9px] leading-relaxed', getLineColor(line))}
          >
            {line}
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Stats footer */}
      <div className="border-t border-border px-3 py-2 space-y-1">
        <div className="flex justify-between text-[9px]" data-testid="right-panel-cost">
          <span className="text-fg-ghost">{t('right_panel.cost')}</span>
          <span className="text-agent-dev font-mono">${sessionCostUsd.toFixed(4)}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-fg-ghost">{t('right_panel.tokens')}</span>
          <span className="text-agent-dev font-mono">{tokenCount.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-fg-ghost">{t('right_panel.elapsed')}</span>
          <span className="font-mono text-fg-dim">{elapsedStr}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-fg-ghost">{t('right_panel.modified_files')}</span>
          <span className="text-ok font-mono">{modifiedFiles.length}</span>
        </div>
      </div>
    </div>
  )
}
