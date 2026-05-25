interface Props {
  onOpen: () => void
  onStopAll: () => void
  onRestartAll: () => void
  onSettings: () => void
}

export default function ActionBar({ onOpen, onStopAll, onRestartAll, onSettings }: Readonly<Props>) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
      <button onClick={onOpen}
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]">
        🎯 Orchestrator 열기
      </button>
      <button onClick={onStopAll}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">
        ⏹ 전체 중지
      </button>
      <button onClick={onRestartAll}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">
        ↺ 전체 재시작
      </button>
      <div className="ml-auto">
        <button onClick={onSettings}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">
          ⚙️ 설정
        </button>
      </div>
    </div>
  )
}
