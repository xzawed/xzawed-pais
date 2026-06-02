import React from 'react'
import { motion } from 'framer-motion'
import { useIntegrationsStore, type ActivePanel } from '../../store/integrations.store.js'
import { useAppStore } from '../../store/app.store.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { cn } from '../../lib/utils.js'

interface NavItem { panel: ActivePanel; icon: string; label: string }

const NAV_ITEMS: NavItem[] = [
  { panel: 'chat',    icon: '💬', label: '채팅' },
  { panel: 'github',  icon: '🐙', label: 'GitHub' },
  { panel: 'mcp',     icon: '🔌', label: 'MCP 서버' },
  { panel: 'plugins', icon: '🧩', label: '플러그인' },
  { panel: 'wiki',    icon: '📚', label: '위키' },
]

export function ActivityBar(): React.JSX.Element {
  const { activePanel, setActivePanel } = useIntegrationsStore()
  const { toggleSettings } = useAppStore()

  return (
    <div className="flex w-11 flex-shrink-0 flex-col items-center gap-1 border-r border-border-dim bg-surface-raised py-2">
      {NAV_ITEMS.map((item) => (
        <ActivityButton
          key={item.panel}
          item={item}
          isActive={activePanel === item.panel}
          onClick={() => setActivePanel(item.panel)}
        />
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSettings}
              aria-label="설정"
              data-testid="settings-trigger"
              className="relative flex h-8 w-8 items-center justify-center rounded text-base text-fg-ghost transition-all duration-150 hover:scale-110 hover:bg-border hover:text-fg"
            >
              ⚙
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">설정</TooltipContent>
        </Tooltip>

        <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center text-[11px] font-bold text-white cursor-pointer transition-all duration-150 hover:ring-2 hover:ring-accent/50">
          X
        </div>
      </div>
    </div>
  )
}

function ActivityButton({ item, isActive, onClick }: {
  item: NavItem
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={item.label}
          data-testid={`nav-${item.panel}`}
          className={cn(
            'relative flex h-8 w-8 items-center justify-center rounded text-base transition-all duration-150',
            isActive
              ? 'text-fg hover:bg-accent-bg'
              : 'text-fg-ghost opacity-50 hover:opacity-100 hover:scale-110 hover:bg-border hover:text-fg'
          )}
        >
          {isActive && (
            <motion.div
              layoutId="activity-indicator"
              className="absolute -left-2.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 20, opacity: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            />
          )}
          {item.icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
