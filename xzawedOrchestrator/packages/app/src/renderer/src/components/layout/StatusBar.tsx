import React from 'react'
import { useAppStore } from '../../store/app.store.js'
import { useIntegrationsStore } from '../../store/integrations.store.js'
import { cn } from '../../lib/utils.js'

export function StatusBar(): React.JSX.Element {
  const { serverStatus } = useAppStore()
  const { github, mcp } = useIntegrationsStore()

  return (
    <div className="flex h-5 flex-shrink-0 items-center gap-3 bg-statusbar px-3 text-[10px] text-white/85">
      <span className={cn('flex items-center gap-1', serverStatus !== 'running' && 'opacity-60')}>
        <span className={cn('h-1.5 w-1.5 rounded-full', serverStatus === 'running' ? 'bg-ok' : 'bg-danger')} />
        서버 {serverStatus === 'running' ? '실행중' : serverStatus === 'stopped' ? '중지됨' : '확인중'}
      </span>
      {github.connected && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          GitHub: {github.username}
        </span>
      )}
      {mcp.servers.length > 0 && (
        <span>MCP {mcp.servers.length}개</span>
      )}
      <div className="ml-auto">xzawedPAIS v1.0</div>
    </div>
  )
}
