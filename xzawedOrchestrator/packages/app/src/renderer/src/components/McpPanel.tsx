import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useIntegrationsStore, type McpServerConfig } from '../store/integrations.store.js'
import { Button } from './ui/button.js'

const RECOMMENDED: Array<Omit<McpServerConfig, 'id' | 'autoStart'>> = [
  { name: 'context7',   command: 'npx', args: ['@upstash/context7-mcp'],                       env: {} },
  { name: 'playwright', command: 'npx', args: ['@playwright/mcp@latest'],                      env: {} },
  { name: 'supabase',   command: 'npx', args: ['@supabase/mcp-server-supabase@latest'],         env: { SUPABASE_URL: '', SUPABASE_KEY: '' } },
  { name: 'github-mcp', command: 'npx', args: ['@modelcontextprotocol/server-github'],          env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } },
  { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'], env: {} },
]

type Tab = 'installed' | 'recommended' | 'custom'

function getFieldLabel(t: (key: string) => string, field: 'name' | 'command' | 'args' | 'env'): string {
  if (field === 'name') return t('mcp.field_name')
  if (field === 'command') return t('mcp.field_command')
  if (field === 'args') return t('mcp.field_args')
  return t('mcp.field_env')
}

function getFieldPlaceholder(t: (key: string) => string, field: 'name' | 'command' | 'args' | 'env'): string {
  if (field === 'name') return t('mcp.placeholder_name')
  if (field === 'command') return t('mcp.placeholder_command')
  if (field === 'args') return t('mcp.placeholder_args')
  return t('mcp.placeholder_env')
}

export function McpPanel(): React.JSX.Element {
  const { mcp, setActivePanel } = useIntegrationsStore()
  const { t } = useTranslation('app')
  const [tab, setTab] = useState<Tab>('installed')
  const [form, setForm] = useState({ name: '', command: 'npx', args: '', env: '' })
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      const list = await globalThis.electronAPI?.mcpList() ?? []
      const { setMcpServers: setServers, setMcpStatus: setStatus } = useIntegrationsStore.getState()
      setServers(list.map(({ status: _s, ...s }) => s))
      const statuses = await globalThis.electronAPI?.mcpStatuses() ?? {}
      Object.entries(statuses).forEach(([id, st]) => setStatus(id, st))
    }
    void load().catch((e: unknown) => console.error('[McpPanel] load error:', e))
  }, [])

  async function installRecommended(rec: (typeof RECOMMENDED)[0]): Promise<void> {
    setLoading(rec.name)
    const config: McpServerConfig = { id: rec.name, ...rec, autoStart: true }
    try {
      await globalThis.electronAPI?.mcpAdd(config)
      const { setMcpServers: setServers, setMcpStatus: setStatus } = useIntegrationsStore.getState()
      setServers([...useIntegrationsStore.getState().mcp.servers, config])
      setStatus(rec.name, 'running')
    } finally {
      setLoading(null)
    }
  }

  async function toggle(id: string): Promise<void> {
    setLoading(id)
    const status = mcp.statuses[id]
    const { setMcpStatus: setStatus } = useIntegrationsStore.getState()
    try {
      if (status === 'running') {
        await globalThis.electronAPI?.mcpStop(id)
        setStatus(id, 'stopped')
      } else {
        await globalThis.electronAPI?.mcpStart(id)
        setStatus(id, 'running')
      }
    } catch (err) {
      console.error('[McpPanel] toggle error:', err)
      // 상태 재동기화 — 실제 프로세스 상태를 다시 조회
      try {
        const statuses = await globalThis.electronAPI?.mcpStatuses?.() ?? {}
        Object.entries(statuses).forEach(([sid, st]) =>
          useIntegrationsStore.getState().setMcpStatus(sid, st)
        )
      } catch (e) { console.warn('[McpPanel] status re-sync failed', e) }
    } finally {
      setLoading(null)
    }
  }

  async function remove(id: string): Promise<void> {
    setLoading(id)
    try {
      await globalThis.electronAPI?.mcpRemove(id)
      const { setMcpServers: setServers } = useIntegrationsStore.getState()
      setServers(useIntegrationsStore.getState().mcp.servers.filter((s) => s.id !== id))
    } finally {
      setLoading(null)
    }
  }

  async function addCustom(): Promise<void> {
    if (!form.name || !form.command) return
    const id = form.name.toLowerCase().replace(/\s+/g, '-')
    const args = form.args.split(' ').filter(Boolean)
    let env: Record<string, string> = {}
    let envParseError = false
    try { env = JSON.parse(form.env || '{}') } catch {
      env = {}
      envParseError = true
    }
    if (envParseError) {
      console.warn('[McpPanel] env JSON parse failed, using {}')
      toast.error('환경변수 JSON 형식이 올바르지 않습니다. 빈 값으로 대체합니다.')
    }
    const config: McpServerConfig = { id, name: form.name, command: form.command, args, env, autoStart: true }
    setLoading(id)
    try {
      await globalThis.electronAPI?.mcpAdd(config)
      const { setMcpServers: setServers, setMcpStatus: setStatus } = useIntegrationsStore.getState()
      setServers([...useIntegrationsStore.getState().mcp.servers, config])
      setStatus(id, 'running')
      setForm({ name: '', command: 'npx', args: '', env: '' })
      setTab('installed')
    } finally {
      setLoading(null)
    }
  }

  const installedIds = new Set(mcp.servers.map((s) => s.id))

  return (
    <div data-testid="mcp-panel" className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 bg-bg">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" data-testid="mcp-back-button" onClick={() => setActivePanel('chat')}>{t('back_to_chat', { ns: 'common' })}</Button>
        <h2 className="text-[13px] font-semibold text-fg">{t('mcp.title')}</h2>
      </div>

      <div className="flex border-b border-border">
        <button
          key="installed"
          data-testid="mcp-tab-installed"
          onClick={() => setTab('installed')}
          className={[
            'px-4 py-2 text-[13px] border-b-2 -mb-px transition-colors',
            tab === 'installed'
              ? 'text-fg border-accent'
              : 'text-fg-ghost border-transparent hover:text-fg',
          ].join(' ')}
        >
          {t('mcp.tab_installed', { count: mcp.servers.length })}
        </button>
        <button
          key="recommended"
          data-testid="mcp-tab-recommended"
          onClick={() => setTab('recommended')}
          className={[
            'px-4 py-2 text-[13px] border-b-2 -mb-px transition-colors',
            tab === 'recommended'
              ? 'text-fg border-accent'
              : 'text-fg-ghost border-transparent hover:text-fg',
          ].join(' ')}
        >
          {t('mcp.tab_recommended')}
        </button>
        <button
          key="custom"
          data-testid="mcp-tab-custom"
          onClick={() => setTab('custom')}
          className={[
            'px-4 py-2 text-[13px] border-b-2 -mb-px transition-colors',
            tab === 'custom'
              ? 'text-fg border-accent'
              : 'text-fg-ghost border-transparent hover:text-fg',
          ].join(' ')}
        >
          {t('mcp.tab_custom')}
        </button>
      </div>

      {tab === 'installed' && (
        <div className="flex flex-col gap-2">
          {mcp.servers.length === 0 && (
            <div data-testid="mcp-empty-message" className="py-10 text-center text-[11px] text-fg-ghost">
              {t('mcp.no_servers')}
            </div>
          )}
          {mcp.servers.map((s) => {
            const status = mcp.statuses[s.id] ?? 'stopped'
            let statusColor = 'text-fg-ghost'
            if (status === 'running') statusColor = 'text-ok'
            else if (status === 'error') statusColor = 'text-danger'

            let toggleLabel = t('start', { ns: 'common' })
            if (loading === s.id) toggleLabel = t('mcp.toggle_loading')
            else if (status === 'running') toggleLabel = t('stop', { ns: 'common' })
            return (
              <div key={s.id} className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2 text-[11px] text-fg">
                <span className={`mr-2 text-[10px] ${statusColor}`}>●</span>
                <div className="flex-1">
                  <div className="font-mono text-[11px] text-fg font-semibold">{s.name}</div>
                  <div className="text-[10px] text-fg-ghost">{s.command} {s.args.join(' ')}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" disabled={loading === s.id} onClick={() => void toggle(s.id)}>
                    {toggleLabel}
                  </Button>
                  <Button variant="danger" size="sm" disabled={loading === s.id} onClick={() => void remove(s.id)}>{t('remove', { ns: 'common' })}</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'recommended' && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {RECOMMENDED.map((rec) => {
            const installed = installedIds.has(rec.name)
            let installBtnLabel = t('install', { ns: 'common' })
            if (loading === rec.name) installBtnLabel = t('installing', { ns: 'common' })
            else if (installed) installBtnLabel = t('installed', { ns: 'common' })
            return (
              <div key={rec.name} data-testid="mcp-recommended-item" className="flex flex-col gap-2 rounded border border-border bg-surface px-3 py-3">
                <div className="text-[13px] font-semibold text-fg">{rec.name}</div>
                <div className="text-[11px] text-fg-ghost">{rec.command} {rec.args.join(' ')}</div>
                <Button
                  variant={installed ? 'outline' : 'default'}
                  size="sm"
                  className="w-full"
                  disabled={installed || loading === rec.name}
                  onClick={() => void installRecommended(rec)}
                >
                  {installBtnLabel}
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'custom' && (
        <div className="flex flex-col gap-3 rounded border border-border bg-surface px-4 py-4">
          {(['name', 'command', 'args', 'env'] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-[11px] text-fg-ghost">
                {getFieldLabel(t, field)}
              </label>
              <input
                className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-fg placeholder:text-fg-ghost focus:outline-none focus:border-accent"
                placeholder={getFieldPlaceholder(t, field)}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </div>
          ))}
          <Button variant="default" onClick={() => void addCustom()} disabled={!form.name || !form.command}>
            {t('mcp.btn_add_start')}
          </Button>
        </div>
      )}
    </div>
  )
}
