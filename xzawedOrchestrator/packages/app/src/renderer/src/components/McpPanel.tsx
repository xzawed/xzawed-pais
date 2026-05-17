import React, { useEffect, useState } from 'react'
import { useIntegrationsStore, type McpServerConfig } from '../store/integrations.store.js'

const RECOMMENDED: Array<Omit<McpServerConfig, 'id' | 'autoStart'>> = [
  { name: 'context7',   command: 'npx', args: ['@upstash/context7-mcp'],                       env: {} },
  { name: 'playwright', command: 'npx', args: ['@playwright/mcp@latest'],                      env: {} },
  { name: 'supabase',   command: 'npx', args: ['@supabase/mcp-server-supabase@latest'],         env: { SUPABASE_URL: '', SUPABASE_KEY: '' } },
  { name: 'github-mcp', command: 'npx', args: ['@modelcontextprotocol/server-github'],          env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } },
  { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'], env: {} },
]

type Tab = 'installed' | 'recommended' | 'custom'

export function McpPanel(): React.JSX.Element {
  const { mcp, setMcpServers, setMcpStatus, setActivePanel } = useIntegrationsStore()
  const [tab, setTab] = useState<Tab>('installed')
  const [form, setForm] = useState({ name: '', command: 'npx', args: '', env: '' })
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      const list = await window.electronAPI?.mcpList() ?? []
      const { setMcpServers: setServers, setMcpStatus: setStatus } = useIntegrationsStore.getState()
      setServers(list.map(({ status: _s, ...s }) => s))
      const statuses = await window.electronAPI?.mcpStatuses() ?? {}
      Object.entries(statuses).forEach(([id, st]) => setStatus(id, st))
    }
    void load()
  }, [])

  async function installRecommended(rec: (typeof RECOMMENDED)[0]): Promise<void> {
    setLoading(rec.name)
    const config: McpServerConfig = { id: rec.name, ...rec, autoStart: true }
    try {
      await window.electronAPI?.mcpAdd(config)
      const { setMcpServers: setServers, setMcpStatus: setStatus } = useIntegrationsStore.getState()
      setServers([...mcp.servers, config])
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
        await window.electronAPI?.mcpStop(id)
        setStatus(id, 'stopped')
      } else {
        await window.electronAPI?.mcpStart(id)
        setStatus(id, 'running')
      }
    } finally {
      setLoading(null)
    }
  }

  async function remove(id: string): Promise<void> {
    await window.electronAPI?.mcpRemove(id)
    const { setMcpServers: setServers } = useIntegrationsStore.getState()
    setServers(mcp.servers.filter((s) => s.id !== id))
  }

  async function addCustom(): Promise<void> {
    if (!form.name || !form.command) return
    const id = form.name.toLowerCase().replace(/\s+/g, '-')
    const args = form.args.split(' ').filter(Boolean)
    let env: Record<string, string> = {}
    try { env = JSON.parse(form.env || '{}') } catch { env = {} }
    const config: McpServerConfig = { id, name: form.name, command: form.command, args, env, autoStart: true }
    setLoading(id)
    try {
      await window.electronAPI?.mcpAdd(config)
      const { setMcpServers: setServers, setMcpStatus: setStatus } = useIntegrationsStore.getState()
      setServers([...mcp.servers, config])
      setStatus(id, 'running')
      setForm({ name: '', command: 'npx', args: '', env: '' })
      setTab('installed')
    } finally {
      setLoading(null)
    }
  }

  const installedIds = new Set(mcp.servers.map((s) => s.id))

  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 채팅으로</button>
        <h2>🔌 MCP 서버</h2>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #2a2a4a', marginBottom: 20 }}>
        {(['installed', 'recommended', 'custom'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
              color: tab === t ? '#e0e0e0' : '#6a6a8a',
              borderBottom: tab === t ? '2px solid #4a4aaa' : '2px solid transparent',
              fontSize: 13,
            }}
          >
            {t === 'installed' ? `설치됨 (${mcp.servers.length})` : t === 'recommended' ? '추천 서버' : '직접 추가'}
          </button>
        ))}
      </div>

      {tab === 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mcp.servers.length === 0 && (
            <div style={{ color: '#6a6a8a', textAlign: 'center', padding: 40 }}>
              설치된 MCP 서버가 없습니다. &quot;추천 서버&quot; 탭에서 설치하세요.
            </div>
          )}
          {mcp.servers.map((s) => {
            const status = mcp.statuses[s.id] ?? 'stopped'
            return (
              <div key={s.id} className="panel-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 10, color: status === 'running' ? '#4caf50' : status === 'error' ? '#f44336' : '#9e9e9e' }}>●</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ color: '#6a6a8a', fontSize: 11 }}>{s.command} {s.args.join(' ')}</div>
                </div>
                <button className="panel-btn panel-btn--ghost" disabled={loading === s.id} onClick={() => void toggle(s.id)}>
                  {loading === s.id ? '...' : status === 'running' ? '중지' : '시작'}
                </button>
                <button className="panel-btn panel-btn--danger" onClick={() => void remove(s.id)}>제거</button>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'recommended' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {RECOMMENDED.map((rec) => {
            const installed = installedIds.has(rec.name)
            return (
              <div key={rec.name} className="panel-card">
                <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>{rec.name}</div>
                <div style={{ color: '#6a6a8a', fontSize: 11, marginBottom: 12 }}>{rec.command} {rec.args.join(' ')}</div>
                <button
                  className={`panel-btn ${installed ? 'panel-btn--success' : 'panel-btn--primary'}`}
                  style={{ width: '100%' }}
                  disabled={installed || loading === rec.name}
                  onClick={() => void installRecommended(rec)}
                >
                  {loading === rec.name ? '설치 중...' : installed ? '✓ 설치됨' : '+ 설치'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'custom' && (
        <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(['name', 'command', 'args', 'env'] as const).map((field) => (
            <div key={field}>
              <label style={{ color: '#a0a0c0', fontSize: 12, display: 'block', marginBottom: 4 }}>
                {field === 'name' ? '이름' : field === 'command' ? '실행 명령어' : field === 'args' ? '인수 (공백 구분)' : '환경변수 (JSON)'}
              </label>
              <input
                style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13, boxSizing: 'border-box' }}
                placeholder={
                  field === 'name' ? '예: my-custom-mcp' :
                  field === 'command' ? '예: npx' :
                  field === 'args' ? '예: @org/mcp-server --port 8080' :
                  '예: {"API_KEY": "sk-..."}'
                }
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </div>
          ))}
          <button className="panel-btn panel-btn--primary" onClick={() => void addCustom()} disabled={!form.name || !form.command}>
            + 추가 및 시작
          </button>
        </div>
      )}
    </div>
  )
}
