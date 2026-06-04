import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIntegrationsStore, type PluginInfo } from '../store/integrations.store.js'
import { Button } from './ui/button.js'
import { Badge } from './ui/badge.js'

export function PluginPanel(): React.JSX.Element {
  const { plugins, setActivePanel } = useIntegrationsStore()
  const { t } = useTranslation('app')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'claude-code' | 'xzawed'>('all')
  const [loading, setLoading] = useState<string | null>(null)
  const [installForm, setInstallForm] = useState({ pkg: '', type: 'claude-code' as PluginInfo['type'] })
  const [showInstall, setShowInstall] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      const list = await globalThis.electronAPI?.pluginList() ?? []
      useIntegrationsStore.getState().setPlugins(list)
    }
    void load().catch((e: unknown) => console.error('[PluginPanel] load error:', e))
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
      await globalThis.electronAPI?.pluginToggle(id)
      useIntegrationsStore.getState().togglePlugin(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plugins.error_toggle'))
    } finally {
      setLoading(null)
    }
  }

  async function handleUninstall(id: string): Promise<void> {
    if (loading) return
    setLoading(id)
    try {
      await globalThis.electronAPI?.pluginUninstall(id)
      const { plugins: current, setPlugins: set } = useIntegrationsStore.getState()
      set(current.filter((p) => p.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plugins.error_uninstall'))
    } finally {
      setLoading(null)
    }
  }

  async function handleInstall(): Promise<void> {
    if (!installForm.pkg || loading) return
    setLoading('__installing__')
    setError(null)
    try {
      await globalThis.electronAPI?.pluginInstall(installForm.pkg, installForm.type)
      const list = await globalThis.electronAPI?.pluginList() ?? []
      useIntegrationsStore.getState().setPlugins(list)
      setInstallForm({ pkg: '', type: 'claude-code' })
      setShowInstall(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plugins.error_install'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div data-testid="plugin-panel" className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 bg-bg">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setActivePanel('chat')}>{t('back_to_chat', { ns: 'common' })}</Button>
        <h2 className="text-[13px] font-semibold text-fg">{t('plugins.title')}</h2>
        <div className="ml-auto">
          <Button
            variant="default"
            size="sm"
            onClick={() => { setShowInstall(!showInstall); setError(null) }}
          >
            {t('plugins.install_btn')}
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-danger">{error}</p>
      )}

      {showInstall && (
        <div className="flex items-end gap-2 rounded border border-border bg-surface px-4 py-3">
          <div className="flex-1 flex flex-col gap-1">
            <label htmlFor="plugin-pkg" className="text-[11px] text-fg-ghost">{t('plugins.pkg_label')}</label>
            <input
              id="plugin-pkg"
              className="w-full rounded border border-border bg-bg px-3 py-1.5 text-[12px] text-fg placeholder:text-fg-ghost focus:outline-none focus:border-accent"
              placeholder={t('plugins.pkg_placeholder')}
              value={installForm.pkg}
              onChange={(e) => setInstallForm({ ...installForm, pkg: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="plugin-type" className="text-[11px] text-fg-ghost">{t('plugins.type_label')}</label>
            <select
              id="plugin-type"
              className="rounded border border-border bg-bg px-3 py-1.5 text-[12px] text-fg focus:outline-none"
              value={installForm.type}
              onChange={(e) => setInstallForm({ ...installForm, type: e.target.value as PluginInfo['type'] })}
            >
              <option value="claude-code">Claude Code</option>
              <option value="xzawed">xzawed</option>
            </select>
          </div>
          <Button
            variant="default"
            size="sm"
            disabled={!installForm.pkg || loading === '__installing__'}
            onClick={() => void handleInstall()}
          >
            {loading === '__installing__' ? t('plugins.install_loading') : t('plugins.install_submit')}
          </Button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          data-testid="plugin-search"
          className="flex-1 rounded border border-border bg-surface px-3 py-2 text-[13px] text-fg placeholder:text-fg-ghost focus:outline-none focus:border-accent"
          placeholder={t('plugins.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border border-border bg-surface px-3 py-2 text-[13px] text-fg focus:outline-none"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">{t('plugins.filter_all')}</option>
          <option value="claude-code">Claude Code</option>
          <option value="xzawed">xzawed</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 && (
          <div className="py-10 text-center text-[11px] text-fg-ghost">
            {search ? t('plugins.no_results') : t('plugins.no_plugins')}
          </div>
        )}
        {filtered.map((p) => {
          let toggleLabel = p.enabled ? t('plugins.toggle_disable') : t('plugins.toggle_enable')
          if (loading === p.id) toggleLabel = t('plugins.toggle_loading')
          return (
            <div key={p.id} className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[13px] font-semibold text-fg">{p.name}</span>
                  <Badge variant="active">
                    {p.type === 'claude-code' ? 'claude-code' : 'xzawed'}
                  </Badge>
                  {p.enabled
                    ? <Badge variant="ok">active</Badge>
                    : <Badge variant="muted">disabled</Badge>
                  }
                </div>
                <div className="text-[11px] text-fg-ghost">{p.description} · v{p.version}</div>
              </div>
              <div className="flex items-center gap-1.5 ml-3">
                <Button
                  variant={p.enabled ? 'ghost' : 'default'}
                  size="sm"
                  disabled={loading === p.id}
                  onClick={() => void handleToggle(p.id)}
                >
                  {toggleLabel}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={loading === p.id}
                  onClick={() => void handleUninstall(p.id)}
                >
                  {t('plugins.uninstall')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
