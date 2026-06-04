import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { Button } from './ui/button.js'

export function GitHubPanel(): React.JSX.Element {
  const {
    github,
    setGitHubConnected,
    setGitHubRepos,
    setDefaultRepo,
    disconnectGitHub,
    setActivePanel,
  } = useIntegrationsStore()
  const { t } = useTranslation('app')

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    async function restoreStatus(): Promise<void> {
      const status = await globalThis.electronAPI?.githubGetStatus()
      if (status?.connected && status.username) {
        const { setGitHubConnected, setGitHubRepos } = useIntegrationsStore.getState()
        setGitHubConnected(status.username, status.avatarUrl ?? '')
        const repos = await globalThis.electronAPI?.githubListRepos() ?? []
        setGitHubRepos(repos)
      }
    }
    void restoreStatus().catch((e: unknown) => console.error('[GitHubPanel] restoreStatus error:', e))
  }, [])

  async function handleConnect(): Promise<void> {
    setLoading(true); setError(null)
    try {
      const result = await globalThis.electronAPI?.githubConnect()
      if (!result) throw new Error(t('github.error_connect'))
      setGitHubConnected(result.username, result.avatarUrl)
      const repos = await globalThis.electronAPI?.githubListRepos() ?? []
      setGitHubRepos(repos)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('github.error_connect_generic'))
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (loading) return
    setLoading(true)
    try {
      await globalThis.electronAPI?.githubDisconnect()
      disconnectGitHub()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('github.error_disconnect'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-testid="github-panel" className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 bg-bg">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setActivePanel('chat')}>{t('back_to_chat', { ns: 'common' })}</Button>
        <h2 data-testid="github-panel-title" className="text-[13px] font-semibold text-fg">{t('github.title')}</h2>
      </div>

      {error && (
        <p className="text-[11px] text-danger">{error}</p>
      )}

      {github.connected ? (
        <>
          <div className="flex items-center gap-4 rounded border border-border bg-surface px-4 py-3">
            {github.avatarUrl && (
              <img src={github.avatarUrl} alt="avatar" className="h-12 w-12 rounded-full" />
            )}
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-fg">{github.username}</div>
              <div className="text-[11px] text-fg-ghost">{t('github.connected')}</div>
            </div>
            <Button variant="danger" onClick={handleDisconnect} disabled={loading}>
              {t('github.disconnect')}
            </Button>
          </div>

          <div className="flex flex-col gap-2 rounded border border-border bg-surface px-4 py-3">
            <div className="text-[13px] font-semibold text-fg">{t('github.default_repo')}</div>
            <select
              className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-fg focus:outline-none"
              value={github.defaultRepo ?? ''}
              onChange={(e) => setDefaultRepo(e.target.value)}
            >
              <option value="">{t('github.select_repo')}</option>
              {github.repos.map((r) => (
                <option key={r.id} value={r.fullName}>{r.fullName} {r.private ? '🔒' : ''}</option>
              ))}
            </select>
            <p className="text-[11px] text-fg-ghost">
              {t('github.repo_hint')}
            </p>
          </div>

          <div className="text-[13px] font-semibold text-fg">
            {t('github.repo_count', { count: github.repos.length })}
          </div>
          <div data-testid="github-repo-list" className="flex flex-col gap-1.5">
            {github.repos.map((repo) => (
              <div key={repo.id} className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2">
                <span className="text-[12px] text-fg">{repo.fullName}</span>
                {repo.private && <span className="text-[11px] text-fg-ghost">{t('github.private_label')}</span>}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded border border-border bg-surface px-6 py-10">
          <p data-testid="github-connect-hint" className="text-[11px] text-fg-ghost text-center">
            {t('github.connect_hint')}
          </p>
          <Button data-testid="github-oauth-button" variant="default" onClick={handleConnect} disabled={loading}>
            {loading ? t('loading', { ns: 'common' }) : t('github.login_button')}
          </Button>
          <p className="text-[11px] text-fg-ghost text-center">
            {t('github.oauth_hint')}
          </p>
        </div>
      )}
    </div>
  )
}
