import React, { useEffect, useState } from 'react'
import { useIntegrationsStore, type PluginInfo } from '../store/integrations.store.js'

export function PluginPanel(): React.JSX.Element {
  const { plugins, setPlugins, togglePlugin, setActivePanel } = useIntegrationsStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'claude-code' | 'xzawed'>('all')
  const [loading, setLoading] = useState<string | null>(null)
  const [installForm, setInstallForm] = useState({ pkg: '', type: 'claude-code' as PluginInfo['type'] })
  const [showInstall, setShowInstall] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      const list = await window.electronAPI?.pluginList() ?? []
      useIntegrationsStore.getState().setPlugins(list)
    }
    void load()
  }, [])

  const filtered = plugins.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || p.type === filter
    return matchSearch && matchFilter
  })

  async function handleToggle(id: string): Promise<void> {
    if (loading) return
    setLoading(id)
    try {
      await window.electronAPI?.pluginToggle(id)
      useIntegrationsStore.getState().togglePlugin(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '토글 실패')
    } finally {
      setLoading(null)
    }
  }

  async function handleUninstall(id: string): Promise<void> {
    if (loading) return
    setLoading(id)
    try {
      await window.electronAPI?.pluginUninstall(id)
      const { plugins: current, setPlugins: set } = useIntegrationsStore.getState()
      set(current.filter((p) => p.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '제거 실패')
    } finally {
      setLoading(null)
    }
  }

  async function handleInstall(): Promise<void> {
    if (!installForm.pkg || loading) return
    setLoading('__installing__')
    setError(null)
    try {
      await window.electronAPI?.pluginInstall(installForm.pkg, installForm.type)
      const list = await window.electronAPI?.pluginList() ?? []
      useIntegrationsStore.getState().setPlugins(list)
      setInstallForm({ pkg: '', type: 'claude-code' })
      setShowInstall(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '설치 실패')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 채팅으로</button>
        <h2>📦 Plugins</h2>
        <button
          className="panel-btn panel-btn--primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => { setShowInstall(!showInstall); setError(null) }}
        >
          + 설치
        </button>
      </div>

      {error && <p style={{ color: '#f44336', fontSize: 12, margin: '0 0 12px' }}>{error}</p>}

      {showInstall && (
        <div className="panel-card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#a0a0c0', fontSize: 11, display: 'block', marginBottom: 4 }}>패키지명</label>
            <input
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '7px 10px', color: '#e0e0e0', fontSize: 12, boxSizing: 'border-box' }}
              placeholder="예: claude-plugins-official/figma"
              value={installForm.pkg}
              onChange={(e) => setInstallForm({ ...installForm, pkg: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#a0a0c0', fontSize: 11, display: 'block', marginBottom: 4 }}>종류</label>
            <select
              style={{ background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '7px 10px', color: '#e0e0e0', fontSize: 12 }}
              value={installForm.type}
              onChange={(e) => setInstallForm({ ...installForm, type: e.target.value as PluginInfo['type'] })}
            >
              <option value="claude-code">Claude Code</option>
              <option value="xzawed">xzawed</option>
            </select>
          </div>
          <button
            className="panel-btn panel-btn--primary"
            disabled={!installForm.pkg || loading === '__installing__'}
            onClick={() => void handleInstall()}
          >
            {loading === '__installing__' ? '설치 중...' : '설치'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          style={{ flex: 1, background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13 }}
          placeholder="🔍 플러그인 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">전체</option>
          <option value="claude-code">Claude Code</option>
          <option value="xzawed">xzawed</option>
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ color: '#6a6a8a', textAlign: 'center', padding: 40 }}>
            {search ? '검색 결과가 없습니다.' : '설치된 플러그인이 없습니다.'}
          </div>
        )}
        {filtered.map((p) => (
          <div key={p.id} className="panel-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                <span className={`badge badge--${p.type === 'claude-code' ? 'claude-code' : 'xzawed'}`}>
                  {p.type === 'claude-code' ? 'Claude Code' : 'xzawed'}
                </span>
                <span className={`badge badge--${p.enabled ? 'active' : 'inactive'}`}>
                  {p.enabled ? '활성' : '비활성'}
                </span>
              </div>
              <div style={{ color: '#6a6a8a', fontSize: 11 }}>{p.description} · v{p.version}</div>
            </div>
            <button
              className={`panel-btn ${p.enabled ? 'panel-btn--ghost' : 'panel-btn--primary'}`}
              disabled={loading === p.id}
              onClick={() => void handleToggle(p.id)}
            >
              {loading === p.id ? '...' : p.enabled ? '비활성화' : '활성화'}
            </button>
            <button
              className="panel-btn panel-btn--danger"
              disabled={loading === p.id}
              onClick={() => void handleUninstall(p.id)}
            >
              제거
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
