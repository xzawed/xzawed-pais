import type { ServiceState, ServiceStatus } from '@xzawed/launcher-shared'

interface Props { service: ServiceState; onRestart: () => void; onStop: () => void }

const STATUS_STYLE: Record<ServiceStatus, { dot: string; label: string; border: string }> = {
  running:    { dot: 'bg-green-400',  label: '실행 중',    border: 'border-green-500/40' },
  starting:   { dot: 'bg-yellow-400', label: '시작 중...', border: 'border-yellow-500/40' },
  restarting: { dot: 'bg-yellow-400', label: '재시작 중',  border: 'border-yellow-500/40' },
  error:      { dot: 'bg-red-400',    label: '오류',       border: 'border-red-500/40' },
  stopped:    { dot: 'bg-zinc-500',   label: '중지됨',     border: 'border-zinc-700' },
}

export default function ServiceRow({ service, onRestart, onStop }: Readonly<Props>) {
  const st = STATUS_STYLE[service.status]
  return (
    <div className={`flex items-center justify-between rounded-md border-l-2 ${st.border} bg-[var(--surface-raised)] px-3 py-1.5`}>
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${st.dot}`} />
        <span className="text-xs font-medium capitalize">{service.name}</span>
        {service.port && <span className="text-[10px] text-[var(--fg-muted)]">:{service.port}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--fg-muted)]">{st.label}</span>
        <button onClick={onRestart} className="text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)]" title="재시작">↺</button>
        <button onClick={onStop} className="text-[11px] text-[var(--fg-muted)] hover:text-red-400" title="중지">⏹</button>
      </div>
    </div>
  )
}
