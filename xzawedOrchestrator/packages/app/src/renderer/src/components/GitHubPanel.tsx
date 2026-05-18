import React, { useEffect, useState } from 'react'
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

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    async function restoreStatus(): Promise<void> {
      const status = await globalThis.electronAPI?.githubGetStatus()
      if (status?.connected && status.username && status.avatarUrl) {
        const { setGitHubConnected, setGitHubRepos } = useIntegrationsStore.getState()
        setGitHubConnected(status.username, status.avatarUrl)
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
      if (!result) throw new Error('연결 실패')
      setGitHubConnected(result.username, result.avatarUrl)
      const repos = await globalThis.electronAPI?.githubListRepos() ?? []
      setGitHubRepos(repos)
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 중 오류가 발생했습니다')
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
      setError(err instanceof Error ? err.message : '연결 해제 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 bg-bg">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setActivePanel('chat')}>← 채팅으로</Button>
        <h2 className="text-[13px] font-semibold text-fg">🐙 GitHub</h2>
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
              <div className="text-[11px] text-fg-ghost">연결됨</div>
            </div>
            <Button variant="danger" onClick={handleDisconnect} disabled={loading}>
              연결 해제
            </Button>
          </div>

          <div className="flex flex-col gap-2 rounded border border-border bg-surface px-4 py-3">
            <div className="text-[13px] font-semibold text-fg">기본 레포지토리</div>
            <select
              className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-fg focus:outline-none"
              value={github.defaultRepo ?? ''}
              onChange={(e) => setDefaultRepo(e.target.value)}
            >
              <option value="">-- 레포 선택 --</option>
              {github.repos.map((r) => (
                <option key={r.id} value={r.fullName}>{r.fullName} {r.private ? '🔒' : ''}</option>
              ))}
            </select>
            <p className="text-[11px] text-fg-ghost">
              선택된 레포를 기준으로 에이전트가 브랜치를 생성하고 코드를 push합니다.
            </p>
          </div>

          <div className="text-[13px] font-semibold text-fg">
            레포지토리 ({github.repos.length}개)
          </div>
          <div className="flex flex-col gap-1.5">
            {github.repos.map((repo) => (
              <div key={repo.id} className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2">
                <span className="text-[12px] text-fg">{repo.fullName}</span>
                {repo.private && <span className="text-[11px] text-fg-ghost">🔒 private</span>}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded border border-border bg-surface px-6 py-10">
          <p className="text-[11px] text-fg-ghost text-center">
            GitHub 계정을 연결하면 에이전트가 레포지토리 생성, 코드 push, PR 생성을 자동으로 수행합니다.
          </p>
          <Button variant="default" onClick={handleConnect} disabled={loading}>
            {loading ? '브라우저에서 인증 중...' : '🐙 GitHub으로 로그인'}
          </Button>
          <p className="text-[11px] text-fg-ghost text-center">
            GitHub OAuth App Client ID/Secret이 환경변수 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET에 설정돼 있어야 합니다.
          </p>
        </div>
      )}
    </div>
  )
}
