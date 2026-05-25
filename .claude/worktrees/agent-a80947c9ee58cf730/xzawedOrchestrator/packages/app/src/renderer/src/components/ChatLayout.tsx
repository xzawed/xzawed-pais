import React from 'react'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { ActivityBar } from './layout/ActivityBar.js'
import { Sidebar } from './Sidebar.js'
import { RightPanel } from './layout/RightPanel.js'
import { ChatView } from './ChatView.js'
import { DynamicPanel } from './DynamicPanel.js'
import { GitHubPanel } from './GitHubPanel.js'
import { McpPanel } from './McpPanel.js'
import { PluginPanel } from './PluginPanel.js'

export function ChatLayout(): React.JSX.Element {
  const { activePanel } = useIntegrationsStore()

  return (
    <div className="flex flex-1 overflow-hidden min-w-0">
      <ActivityBar />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {activePanel === 'chat' && (
          <div className="flex flex-1 overflow-hidden">
            <ChatView />
            <DynamicPanel />
          </div>
        )}
        {activePanel === 'github'  && <GitHubPanel />}
        {activePanel === 'mcp'     && <McpPanel />}
        {activePanel === 'plugins' && <PluginPanel />}
      </div>
      {activePanel === 'chat' && <RightPanel />}
    </div>
  )
}
