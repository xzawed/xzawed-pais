import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store/app.store.js'
import { useIntegrationsStore } from '../../store/integrations.store.js'
import { cn } from '../../lib/utils.js'

export function StatusBar(): React.JSX.Element {
  const { t } = useTranslation('app')
  const { serverStatus } = useAppStore()
  const { github, mcp } = useIntegrationsStore()

  function statusLabel(): string {
    if (serverStatus === 'running') return t('status_bar.running')
    if (serverStatus === 'stopped') return t('status_bar.stopped')
    return t('status_bar.checking')
  }

  return (
    <div
      data-testid="status-bar"
      className="flex h-5 flex-shrink-0 items-center gap-3 bg-statusbar px-3 text-[10px] text-white/85"
    >
      <span
        data-testid={serverStatus === 'running' ? 'status-bar-running' : serverStatus === 'stopped' ? 'status-bar-error' : 'status-bar-unknown'}
        className={cn('flex items-center gap-1', serverStatus !== 'running' && 'opacity-60')}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', serverStatus === 'running' ? 'bg-ok' : 'bg-danger')} />
        {t('status_bar.server')} {statusLabel()}
      </span>
      {github.connected && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          GitHub: {github.username}
        </span>
      )}
      {mcp.servers.length > 0 && (
        <span>{t('status_bar.mcp_count', { count: mcp.servers.length })}</span>
      )}
      <div className="ml-auto">xzawedPAIS</div>
    </div>
  )
}
