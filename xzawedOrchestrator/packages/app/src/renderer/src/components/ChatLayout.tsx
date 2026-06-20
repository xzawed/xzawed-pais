import React, { useCallback, useState } from 'react'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { useSessionWs } from '../lib/useSessionWs.js'
import { ActivityBar } from './layout/ActivityBar.js'
import { ResizeHandle } from './layout/ResizeHandle.js'
import { Sidebar } from './Sidebar.js'
import { RightPanel } from './layout/RightPanel.js'
import { ChatView } from './ChatView.js'
import { DynamicPanel } from './DynamicPanel.js'
import { GitHubPanel } from './GitHubPanel.js'
import { McpPanel } from './McpPanel.js'
import { PluginPanel } from './PluginPanel.js'
import { WikiPanel } from './WikiPanel.js'
import { DecisionsPanel } from './DecisionsPanel.js'

const SIDEBAR_MIN = 150
const SIDEBAR_MAX = 420
const DYNAMIC_MIN = 180
const DYNAMIC_MAX = 520
const RIGHT_MIN = 140
const RIGHT_MAX = 400

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function loadWidth(key: string, defaultValue: number): number {
  try {
    const saved = localStorage.getItem(key)
    return saved ? parseInt(saved, 10) : defaultValue
  } catch {
    return defaultValue
  }
}

function saveWidth(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch { /* ignore */ }
}

export function ChatLayout(): React.JSX.Element {
  const { activePanel } = useIntegrationsStore()
  // 세션 WS를 패널과 무관하게 항상 구독 — wiki 탭 등으로 ChatView가 언마운트돼도 끊기지 않는다.
  useSessionWs()

  const [sidebarWidth, setSidebarWidth] = useState(() => loadWidth('layout.sidebar', 210))
  const [dynamicWidth, setDynamicWidth] = useState(() => loadWidth('layout.dynamic', 280))
  const [rightWidth, setRightWidth]     = useState(() => loadWidth('layout.right', 200))

  const resizeSidebar = useCallback((delta: number) => {
    setSidebarWidth(w => {
      const next = clamp(w + delta, SIDEBAR_MIN, SIDEBAR_MAX)
      saveWidth('layout.sidebar', next)
      return next
    })
  }, [])

  const resizeDynamic = useCallback((delta: number) => {
    setDynamicWidth(w => {
      const next = clamp(w - delta, DYNAMIC_MIN, DYNAMIC_MAX)
      saveWidth('layout.dynamic', next)
      return next
    })
  }, [])

  const resizeRight = useCallback((delta: number) => {
    setRightWidth(w => {
      const next = clamp(w - delta, RIGHT_MIN, RIGHT_MAX)
      saveWidth('layout.right', next)
      return next
    })
  }, [])

  return (
    <div className="flex flex-1 overflow-hidden min-w-0">
      <ActivityBar />
      <Sidebar style={{ width: sidebarWidth }} />
      <ResizeHandle onResize={resizeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {activePanel === 'chat' && (
          <div className="flex flex-1 overflow-hidden">
            <ChatView />
            <ResizeHandle onResize={resizeDynamic} />
            <DynamicPanel style={{ width: dynamicWidth }} />
          </div>
        )}
        {activePanel === 'github'  && <GitHubPanel />}
        {activePanel === 'mcp'     && <McpPanel />}
        {activePanel === 'plugins' && <PluginPanel />}
        {activePanel === 'wiki'    && <WikiPanel />}
        {activePanel === 'decisions' && <DecisionsPanel />}
      </div>
      {activePanel === 'chat' && (
        <>
          <ResizeHandle onResize={resizeRight} />
          <RightPanel style={{ width: rightWidth }} />
        </>
      )}
    </div>
  )
}
