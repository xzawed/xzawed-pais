import { useEffect } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'

export default function StepDocker(): JSX.Element {
  const { dockerStatus, isLoading, error, setDockerStatus, setLoading, setError, setStep } = useWizardStore()

  useEffect(() => {
    let cancelled = false
    let tid: ReturnType<typeof setTimeout>
    void (async () => {
      setLoading(true)
      try {
        const status = await globalThis.launcherAPI!.checkDocker()
        if (cancelled) return
        setDockerStatus(status)
        if (status === 'running') tid = setTimeout(() => setStep('claude'), 800)
      } catch {
        if (!cancelled) setError('Docker 상태 확인 중 오류가 발생했습니다.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true; clearTimeout(tid) }
  }, [setDockerStatus, setLoading, setStep, setError])

  async function handleInstall(): Promise<void> {
    setDockerStatus('installing')
    await globalThis.launcherAPI!.installDocker()
    setDockerStatus('checking')
    setError('Docker 설치 파일을 다운로드했습니다. 설치 완료 후 다시 확인하세요.')
  }

  async function handleStartDesktop(): Promise<void> {
    setLoading(true)
    await globalThis.launcherAPI!.startDockerDesktop()
    const status = await globalThis.launcherAPI!.checkDocker()
    setDockerStatus(status)
    setLoading(false)
    if (status === 'running') setStep('claude')
  }

  const statusMap = {
    checking: { icon: '🔍', text: 'Docker 확인 중...', color: 'text-[var(--fg-muted)]' },
    running: { icon: '✅', text: 'Docker 실행 중', color: 'text-green-400' },
    'installed-stopped': { icon: '⚠️', text: 'Docker가 중지되어 있습니다', color: 'text-yellow-400' },
    'not-installed': { icon: '❌', text: 'Docker가 설치되지 않았습니다', color: 'text-red-400' },
    installing: { icon: '⬇️', text: '설치 파일 다운로드 중...', color: 'text-[var(--accent)]' },
    error: { icon: '❌', text: '오류 발생', color: 'text-red-400' },
  }

  const s = statusMap[dockerStatus] ?? statusMap.checking

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-5xl">🐳</div>
      <h2 className="text-xl font-bold">Docker 확인</h2>
      <div className={`text-sm font-medium ${s.color}`}>{s.icon} {s.text}</div>
      {error && <p className="text-xs text-yellow-400 text-center">{error}</p>}
      {dockerStatus === 'not-installed' && (
        <button onClick={() => void handleInstall()} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
          ⬇️ Docker 자동 설치
        </button>
      )}
      {dockerStatus === 'installed-stopped' && (
        <button onClick={() => void handleStartDesktop()} disabled={isLoading} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
          ▶️ Docker Desktop 시작
        </button>
      )}
    </div>
  )
}
