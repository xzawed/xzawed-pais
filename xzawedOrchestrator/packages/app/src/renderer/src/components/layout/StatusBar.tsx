import React from 'react'
import { useAppStore } from '../../store/app.store.js'
import { useIntegrationsStore } from '../../store/integrations.store.js'
import { cn } from '../../lib/utils.js'

function serverStatusLabel(status: string): string {
  if (status === 'running') return '실행중'
  if (status === 'stopped') return '중지됨'
  return '확인중'
}

export function StatusBar(): React.JSX.Element {
  const { serverStatus } = useAppStore()
  const { github, mcp } = useIntegrationsStore()

  return (
    <div className="flex h-5 flex-shrink-0 items-center gap-3 bg-statusbar px-3 text-[10px] text-white/85">
      <span className={cn('flex items-center gap-1', serverStatus !== 'running' && 'opacity-60')}>
        <span className={cn('h-1.5 w-1.5 rounded-full', serverStatus === 'running' ? 'bg-ok' : 'bg-danger')} />
        서버 {serverStatusLabel(serverStatus)}
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
