import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/app.store.js'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { useChatStore } from '../store/chat.store.js'
import { createSession } from '../lib/api.js'
import {
  Command, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from './ui/command.js'

export function CommandPalette(): React.JSX.Element {
  const { t } = useTranslation('app')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { settings, toggleSettings } = useAppStore()
  const { setActivePanel } = useIntegrationsStore()
  const { initSession } = useChatStore()

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') {
        setSearch((prev) => {
          if (prev) return ''
          setOpen(false)
          return prev
        })
      }
    }
    globalThis.addEventListener('keydown', handler)
    return () => globalThis.removeEventListener('keydown', handler)
  }, [])

  async function newSession(): Promise<void> {
    setOpen(false)
    try {
      const { sessionId } = await createSession(settings.serverUrl, settings.userId)
      initSession(sessionId)
      setActivePanel('chat')
    } catch (e) { console.error('newSession failed', e) }
  }

  function navigate(panel: 'chat' | 'github' | 'mcp' | 'plugins'): void {
    setOpen(false)
    setActivePanel(panel)
  }

  function openSettings(): void {
    setOpen(false)
    toggleSettings()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          />

          <motion.div
            data-testid="command-palette"
            className="fixed left-1/2 top-[30%] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <Command>
              <CommandInput data-testid="command-palette-input" placeholder={t('command_palette.placeholder')} value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>{t('command_palette.no_results')}</CommandEmpty>
                <CommandGroup heading={t('command_palette.session_group')}>
                  <CommandItem data-testid="command-palette-item" value="새 세션" onSelect={newSession}>
                    <span>＋</span> {t('command_palette.new_session')}
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading={t('command_palette.navigate_group')}>
                  <CommandItem data-testid="command-palette-item" value="채팅으로 이동" onSelect={() => navigate('chat')}>
                    <span>💬</span> {t('command_palette.nav_chat')}
                  </CommandItem>
                  <CommandItem data-testid="command-palette-item" value="GitHub 패널" onSelect={() => navigate('github')}>
                    <span>🐙</span> {t('command_palette.nav_github')}
                  </CommandItem>
                  <CommandItem data-testid="command-palette-item" value="MCP 서버 패널" onSelect={() => navigate('mcp')}>
                    <span>🔌</span> {t('command_palette.nav_mcp')}
                  </CommandItem>
                  <CommandItem data-testid="command-palette-item" value="플러그인 패널" onSelect={() => navigate('plugins')}>
                    <span>🧩</span> {t('command_palette.nav_plugins')}
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading={t('command_palette.other_group')}>
                  <CommandItem data-testid="command-palette-item" value="설정" onSelect={openSettings}>
                    <span>⚙</span> {t('command_palette.settings')}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
