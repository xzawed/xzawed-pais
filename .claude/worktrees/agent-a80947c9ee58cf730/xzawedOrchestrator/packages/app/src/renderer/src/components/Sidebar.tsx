import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { createSession } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Badge } from './ui/badge.js'
import { Separator } from './ui/separator.js'

interface SessionEntry {
  id: string
  label: string
  status: 'active' | 'paused' | 'idle'
}

function useSessions(currentSessionId: string | null): { today: SessionEntry[]; yesterday: SessionEntry[] } {
  const today: SessionEntry[] = currentSessionId
    ? [{ id: currentSessionId, label: '현재 세션', status: 'active' }]
    : []
  return { today, yesterday: [] }
}

export function Sidebar(): React.JSX.Element {
  const { settings } = useAppStore()
  const { sessionId, initSession } = useChatStore()
  const { github, mcp, plugins, setActivePanel } = useIntegrationsStore()
  const [isCreating, setIsCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [todayOpen, setTodayOpen] = useState(true)
  const { today } = useSessions(sessionId)

  async function handleNewSession(): Promise<void> {
    if (isCreating) return
    setIsCreating(true)
    try {
      const { sessionId: newId } = await createSession(settings.serverUrl, settings.userId)
      initSession(newId)
      setActivePanel('chat')
    } catch {
      // ignore
    } finally {
      setIsCreating(false)
    }
  }

  const filteredToday = today.filter((s) =>
    s.label.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex w-[210px] flex-shrink-0 flex-col border-r border-border bg-surface overflow-hidden">

      {/* Search */}
      <div className="px-2.5 pt-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 rounded bg-border/60 px-2.5 py-1.5 text-[11px] text-fg-ghost transition-all duration-200 focus-within:bg-border focus-within:ring-1 focus-within:ring-accent/30">
          <span className="text-[10px]">🔍</span>
          <input
            type="text"
            placeholder="세션 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-fg placeholder:text-fg-ghost outline-none text-[11px]"
          />
          <kbd className="rounded bg-surface px-1 py-0.5 text-[8px] text-fg-ghost border border-border">⌘F</kbd>
        </div>
      </div>

      {/* New Session Button */}
      <div className="px-2.5 pb-2">
        <motion.button
          onClick={handleNewSession}
          disabled={isCreating}
          data-testid="new-session-button"
          className="w-full rounded bg-accent py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 flex items-center justify-center gap-1"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.1 }}
        >
          <span>＋</span>
          {isCreating ? '생성 중...' : '새 세션'}
        </motion.button>
      </div>

      <Separator />

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">

        {/* Today group */}
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-1 cursor-pointer select-none"
          onClick={() => setTodayOpen((v) => !v)}
        >
          <span className="text-[9px] uppercase tracking-wide text-fg-ghost">오늘</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-accent">{filteredToday.length}</span>
            <span className={cn('text-[9px] text-fg-ghost transition-transform duration-150', todayOpen ? 'rotate-0' : '-rotate-90')}>▾</span>
          </div>
        </button>

        <AnimatePresence initial={false}>
          {todayOpen && (
            <motion.div
              key="today-sessions"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {filteredToday.map((s, i) => (
                <SessionItem key={s.id} session={s} index={i} isActive={s.id === sessionId} />
              ))}
              {filteredToday.length === 0 && (
                <p className="px-4 py-2 text-[10px] text-fg-ghost">세션이 없습니다</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Separator />

      {/* Integration badges */}
      <div className="flex items-center gap-2 px-3 py-2">
        {github.connected && (
          <Badge variant="ok" className="cursor-pointer" onClick={() => setActivePanel('github')}>
            ● GH
          </Badge>
        )}
        {mcp.servers.length > 0 && (
          <Badge variant="active" className="cursor-pointer" onClick={() => setActivePanel('mcp')}>
            MCP {mcp.servers.length}
          </Badge>
        )}
        {plugins.length > 0 && (
          <Badge variant="muted" className="cursor-pointer" onClick={() => setActivePanel('plugins')}>
            플러그인 {plugins.length}
          </Badge>
        )}
      </div>
    </div>
  )
}

function SessionItem({ session, index, isActive }: Readonly<{
  session: SessionEntry
  index: number
  isActive: boolean
}>): React.JSX.Element {
  const dotColor = {
    active: 'bg-ok animate-pulse-glow-green',
    paused: 'bg-warn',
    idle:   'bg-fg-ghost',
  }[session.status]

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={cn(
        'mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors duration-100',
        'border-l-2',
        isActive
          ? 'border-accent bg-accent-bg text-fg'
          : 'border-transparent text-fg-muted hover:bg-surface-raised hover:text-fg'
      )}
    >
      <div className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', dotColor)} />
      <span className="truncate">{session.label}</span>
    </motion.div>
  )
}
