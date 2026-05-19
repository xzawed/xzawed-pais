import { useEffect, useState } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'

export default function StepClaude(): JSX.Element {
  const { claudeStatus, claudeEmail, setClaudeStatus, setClaudeEmail, setStep } = useWizardStore()
  const [showApiForm, setShowApiForm] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    void (async () => {
      const status = await globalThis.launcherAPI!.checkClaude()
      setClaudeStatus(status)
      if (status === 'logged-in') {
        setTimeout(() => setStep('services'), 800)
      }
    })()
  }, [setClaudeStatus, setClaudeEmail, setStep])

  async function handleBrowserLogin(): Promise<void> {
    await globalThis.launcherAPI!.openClaudeLogin()
    setWaiting(true)
    const ok = await globalThis.launcherAPI!.waitClaudeLogin()
    setWaiting(false)
    if (ok) { setClaudeStatus('logged-in'); setStep('services') }
    else setClaudeStatus('not-logged-in')
  }

  async function handleInstall(): Promise<void> {
    setClaudeStatus('installing')
    await globalThis.launcherAPI!.installClaude()
    setClaudeStatus('not-logged-in')
  }

  async function handleSaveApiKey(): Promise<void> {
    await globalThis.launcherAPI!.saveSetupConfig({ claudeMode: 'api', apiKey, completedAt: new Date().toISOString() })
    setStep('services')
  }

  if (showApiForm) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
          ⚠️ Claude CLI 구독이 없을 경우에만 사용합니다. API 사용량에 따라 요금이 부과됩니다.
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-api03-..."
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex gap-2">
          <button onClick={() => setShowApiForm(false)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-sm text-[var(--fg-muted)]">← CLI로 돌아가기</button>
          <button onClick={() => void handleSaveApiKey()} disabled={!apiKey} className="flex-[2] rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">저장하고 계속 →</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-5xl">🔐</div>
      <h2 className="text-xl font-bold">Claude 인증</h2>
      {claudeStatus === 'logged-in' && (
        <div className="text-sm text-green-400">✅ 로그인됨{claudeEmail ? ` (${claudeEmail})` : ''}</div>
      )}
      {claudeStatus === 'not-logged-in' && (
        <>
          <p className="text-sm text-[var(--fg-muted)] text-center">Claude CLI가 설치되어 있지만 로그인이 필요합니다.</p>
          <button onClick={() => void handleBrowserLogin()} disabled={waiting} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {waiting ? '로그인 대기 중...' : '🌐 브라우저로 로그인'}
          </button>
        </>
      )}
      {claudeStatus === 'not-installed' && (
        <>
          <p className="text-sm text-[var(--fg-muted)] text-center">Claude CLI가 설치되어 있지 않습니다.</p>
          <button onClick={() => void handleInstall()} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white">⬇️ Claude CLI 자동 설치</button>
        </>
      )}
      {claudeStatus === 'installing' && <div className="text-sm text-[var(--accent)]">◌ 설치 중...</div>}
      <button onClick={() => setShowApiForm(true)} className="text-xs text-[var(--accent)] underline mt-2">구독이 없으신가요? API 키로 대신 사용하기</button>
    </div>
  )
}
