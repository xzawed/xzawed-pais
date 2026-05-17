import React, { useEffect, useState } from 'react'
import { useIntegrationsStore } from '../store/integrations.store.js'

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
      const status = await window.electronAPI?.githubGetStatus()
      if (status?.connected && status.username && status.avatarUrl) {
        setGitHubConnected(status.username, status.avatarUrl)
        const repos = await window.electronAPI?.githubListRepos() ?? []
        setGitHubRepos(repos)
      }
    }
    void restoreStatus()
  }, [])

  async function handleConnect(): Promise<void> {
    setLoading(true); setError(null)
    try {
      const result = await window.electronAPI?.githubConnect()
      if (!result) throw new Error('연결 실패')
      setGitHubConnected(result.username, result.avatarUrl)
      const repos = await window.electronAPI?.githubListRepos() ?? []
      setGitHubRepos(repos)
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect(): Promise<void> {
    await window.electronAPI?.githubDisconnect()
    disconnectGitHub()
  }

  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 채팅으로</button>
        <h2>🐙 GitHub</h2>
      </div>

      {!github.connected ? (
        <div className="panel-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#a0a0c0', marginBottom: 24 }}>
            GitHub 계정을 연결하면 에이전트가 레포지토리 생성, 코드 push, PR 생성을 자동으로 수행합니다.
          </p>
          {error && <p style={{ color: '#ff6b6b', marginBottom: 16 }}>{error}</p>}
          <button className="panel-btn panel-btn--primary" onClick={handleConnect} disabled={loading}>
            {loading ? '브라우저에서 인증 중...' : '🐙 GitHub으로 로그인'}
          </button>
          <p style={{ fontSize: 11, color: '#6a6a8a', marginTop: 16 }}>
            GitHub OAuth App Client ID/Secret이 환경변수 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET에 설정돼 있어야 합니다.
          </p>
        </div>
      ) : (
        <>
          <div className="panel-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {github.avatarUrl && (
              <img src={github.avatarUrl} alt="avatar" style={{ width: 48, height: 48, borderRadius: '50%' }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{github.username}</div>
              <div style={{ color: '#6a6a8a', fontSize: 12 }}>연결됨</div>
            </div>
            <button className="panel-btn panel-btn--danger" onClick={handleDisconnect}>
              연결 해제
            </button>
          </div>

          <div className="panel-card">
            <div style={{ color: '#a0a0c0', fontSize: 13, marginBottom: 8 }}>기본 레포지토리</div>
            <select
              style={{ width: '100%', background: '#0f1420', border: '1px solid #2a2a4a', borderRadius: 6, padding: '8px 12px', color: '#e0e0e0', fontSize: 13 }}
              value={github.defaultRepo ?? ''}
              onChange={(e) => setDefaultRepo(e.target.value)}
            >
              <option value="">-- 레포 선택 --</option>
              {github.repos.map((r) => (
                <option key={r.id} value={r.fullName}>{r.fullName} {r.private ? '🔒' : ''}</option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#6a6a8a', marginTop: 8 }}>
              선택된 레포를 기준으로 에이전트가 브랜치를 생성하고 코드를 push합니다.
            </p>
          </div>

          <div style={{ color: '#a0a0c0', fontSize: 12, marginBottom: 8 }}>
            레포지토리 ({github.repos.length}개)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {github.repos.map((repo) => (
              <div key={repo.id} className="panel-card" style={{ display: 'flex', alignItems: 'center', padding: '10px 16px' }}>
                <span style={{ flex: 1, color: '#e0e0e0', fontSize: 13 }}>{repo.fullName}</span>
                {repo.private && <span style={{ fontSize: 11, color: '#6a6a8a' }}>🔒 private</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
