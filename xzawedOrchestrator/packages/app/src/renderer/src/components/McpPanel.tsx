import React, { useEffect, useState } from 'react'
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

function getTabLabel(t: Tab, serverCount: number): string {
  if (t === 'installed') return `설치됨 (${serverCount})`
  if (t === 'recommended') return '추천 서버'
  return '직접 추가'
}

function getFieldLabel(field: 'name' | 'command' | 'args' | 'env'): string {
  if (field === 'name') return '이름'
  if (field === 'command') return '실행 명령어'
  if (field === 'args') return '인수 (공백 구분)'
  return '환경변수 (JSON)'
}

function getFieldPlaceholder(field: 'name' | 'command' | 'args' | 'env'): string {
  if (field === 'name') return '예: my-custom-mcp'
  if (field === 'command') return '예: npx'
  if (field === 'args') return '공백으로 구분 (따옴표 포함 인수 미지원)'
  return '예: {"API_KEY": "sk-..."}'
}

export function McpPanel(): React.JSX.Element {
  const { mcp, setActivePanel } = useIntegrationsStore()
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
          useIntegrationsStore.getState().setMcpStatus(sid, st as 'running' | 'stopped')
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
        <Button variant="ghost" size="sm" onClick={() => setActivePanel('chat')}>← 채팅으로</Button>
        <h2 className="text-[13px] font-semibold text-fg">🔌 MCP 서버</h2>
      </div>

      <div className="flex border-b border-border">
        {(['installed', 'recommended', 'custom'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-[13px] border-b-2 -mb-px transition-colors',
              tab === t
                ? 'text-fg border-accent'
                : 'text-fg-ghost border-transparent hover:text-fg',
            ].join(' ')}
          >
            {getTabLabel(t, mcp.servers.length)}
          </button>
        ))}
      </div>

      {tab === 'installed' && (
        <div className="flex flex-col gap-2">
          {mcp.servers.length === 0 && (
            <div className="py-10 text-center text-[11px] text-fg-ghost">
              설치된 MCP 서버가 없습니다. &quot;추천 서버&quot; 탭에서 설치하세요.
            </div>
          )}
          {mcp.servers.map((s) => {
            const status = mcp.statuses[s.id] ?? 'stopped'
            let statusColor = 'text-fg-ghost'
            if (status === 'running') statusColor = 'text-ok'
            else if (status === 'error') statusColor = 'text-danger'

            let toggleLabel = '시작'
            if (loading === s.id) toggleLabel = '...'
            else if (status === 'running') toggleLabel = '중지'
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
                  <Button variant="danger" size="sm" disabled={loading === s.id} onClick={() => void remove(s.id)}>제거</Button>
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
            let installBtnLabel = '+ 설치'
            if (loading === rec.name) installBtnLabel = '설치 중...'
            else if (installed) installBtnLabel = '✓ 설치됨'
            return (
              <div key={rec.name} className="flex flex-col gap-2 rounded border border-border bg-surface px-3 py-3">
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
                {getFieldLabel(field)}
              </label>
              <input
                className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-fg placeholder:text-fg-ghost focus:outline-none focus:border-accent"
                placeholder={getFieldPlaceholder(field)}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </div>
          ))}
          <Button variant="default" onClick={() => void addCustom()} disabled={!form.name || !form.command}>
            + 추가 및 시작
          </Button>
        </div>
      )}
    </div>
  )
}
