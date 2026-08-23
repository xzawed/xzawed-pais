import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'
import { useServicesStore } from '../../stores/services.store.js'
import { SERVICE_NAMES } from '@xzawed/launcher-shared'
import { waitForAllRunning } from '../../lib/wait-for-services.js'

/** healthcheck 의 start_period 30s + 이미지 초기화. 넉넉히 잡되 무한 대기는 하지 않는다. */
const SERVICES_READY_TIMEOUT_MS = 180_000

export default function StepServices(): JSX.Element {
  const setStep = useWizardStore((s) => s.setStep)
  const { services, logs, setServices, appendLog } = useServicesStore()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retrySignalRef = useRef<{ cancelled: boolean } | null>(null)

  const runServices = useCallback(async (signal: { cancelled: boolean }): Promise<void> => {
    setStarting(true)
    setError(null)
    try {
      await globalThis.launcherAPI!.startAllServices()
      // `up -d` 는 컨테이너를 띄우고 돌아온다 — healthy 를 기다리지 않는다. 한 번만 읽으면
      // 앱 서비스는 언제나 starting 이라 완료 조건이 결코 참이 되지 않는다.
      const result = await waitForAllRunning(
        () => globalThis.launcherAPI!.getServicesStatus(),
        { timeoutMs: SERVICES_READY_TIMEOUT_MS, intervalMs: 2_000 },
      )
      if (signal.cancelled) return
      setServices(result.states)
      if (result.ok) setTimeout(() => { if (!signal.cancelled) setStep('complete') }, 600)
      else if (result.failed.length > 0) setError(`서비스 기동 실패: ${result.failed.join(', ')}`)
      else setError('서비스가 제한 시간 안에 준비되지 않았습니다. 재시도하거나 로그를 확인하세요.')
    } catch (e) {
      if (!signal.cancelled) setError(String(e))
    } finally {
      if (!signal.cancelled) setStarting(false)
    }
  }, [setServices, setStep])

  useEffect(() => {
    const signal = { cancelled: false }
    retrySignalRef.current = signal
    void runServices(signal)
    return () => { signal.cancelled = true }
  }, [runServices])

  useEffect(() => {
    const unsub = globalThis.launcherAPI?.onLogLine(appendLog)
    return () => unsub?.()
  }, [appendLog])

  function statusIcon(name: string): string {
    const s = services.find((x) => x.name === name)
    if (!s) return '○'
    return { running: '●', starting: '◌', restarting: '◌', error: '✕', stopped: '○' }[s.status] ?? '○'
  }

  function statusColor(name: string): string {
    const s = services.find((x) => x.name === name)
    if (!s) return 'text-[var(--fg-muted)]'
    return { running: 'text-green-400', starting: 'text-yellow-400', restarting: 'text-yellow-400', error: 'text-red-400', stopped: 'text-[var(--fg-muted)]' }[s.status] ?? 'text-[var(--fg-muted)]'
  }

  function handleRetry(): void {
    if (retrySignalRef.current) retrySignalRef.current.cancelled = true
    const sig = { cancelled: false }
    retrySignalRef.current = sig
    void runServices(sig)
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-center">서비스 기동</h2>
      <div className="flex flex-col gap-1.5">
        {SERVICE_NAMES.map((name) => (
          <div key={name} className="flex items-center justify-between rounded-md bg-[var(--surface-raised)] px-3 py-2">
            <span className="text-sm capitalize">{name}</span>
            <span className={`text-xs font-mono ${statusColor(name)}`}>{statusIcon(name)}</span>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="rounded-md bg-black/60 p-2 font-mono text-[10px] text-green-400 h-16 overflow-hidden">
        {logs.slice(-5).map((l, i) => <div key={`${i}:${l}`}>{l}</div>)}
      </div>
      {!starting && error && (
        <button onClick={handleRetry}
          className="rounded-lg border border-[var(--border)] py-2 text-sm text-[var(--fg-muted)]">
          재시도
        </button>
      )}
    </div>
  )
}
