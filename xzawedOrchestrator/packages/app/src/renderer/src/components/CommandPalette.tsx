import React, { useState, useEffect } from 'react'
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
            className="fixed left-1/2 top-[30%] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <Command>
              <CommandInput placeholder="명령어 검색..." value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>결과 없음</CommandEmpty>
                <CommandGroup heading="세션">
                  <CommandItem onSelect={newSession}>
                    <span>＋</span> 새 세션 시작
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="이동">
                  <CommandItem onSelect={() => navigate('chat')}>
                    <span>💬</span> 채팅으로 이동
                  </CommandItem>
                  <CommandItem onSelect={() => navigate('github')}>
                    <span>🐙</span> GitHub 패널
                  </CommandItem>
                  <CommandItem onSelect={() => navigate('mcp')}>
                    <span>🔌</span> MCP 서버 패널
                  </CommandItem>
                  <CommandItem onSelect={() => navigate('plugins')}>
                    <span>🧩</span> 플러그인 패널
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="기타">
                  <CommandItem onSelect={openSettings}>
                    <span>⚙</span> 설정 열기
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
