import { useEffect, useState } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'
import { useServicesStore } from '../../stores/services.store.js'
import { SERVICE_NAMES } from '@xzawed/launcher-shared'

export default function StepServices(): JSX.Element {
  const setStep = useWizardStore((s) => s.setStep)
  const { services, logs, setServices, appendLog } = useServicesStore()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startServices(signal: { cancelled: boolean }): Promise<void> {
    setStarting(true)
    setError(null)
    try {
      await globalThis.launcherAPI!.startAllServices()
      const states = await globalThis.launcherAPI!.getServicesStatus()
      if (signal.cancelled) return
      setServices(states)
      const allOk = states.every((s) => s.status === 'running')
      if (allOk) setTimeout(() => { if (!signal.cancelled) setStep('complete') }, 600)
    } catch (e) {
      if (!signal.cancelled) setError(String(e))
    } finally {
      if (!signal.cancelled) setStarting(false)
    }
  }

  useEffect(() => {
    const signal = { cancelled: false }
    void startServices(signal)
    return () => { signal.cancelled = true }
  }, [setServices, setStep])

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
        {logs.slice(-5).map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {!starting && error && (
        <button onClick={() => { const sig = { cancelled: false }; void startServices(sig) }}
          className="rounded-lg border border-[var(--border)] py-2 text-sm text-[var(--fg-muted)]">
          재시도
        </button>
      )}
    </div>
  )
}
