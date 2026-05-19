interface Props {
  info: { version: string; releaseNotes: string }
  onClose: () => void
}

export default function UpdateModal({ info, onClose }: Readonly<Props>) {
  async function handleUpdate(): Promise<void> {
    await globalThis.launcherAPI!.installUpdate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 text-center text-3xl">🆕</div>
        <h3 className="mb-1 text-center text-base font-bold">새 버전 출시</h3>
        <p className="mb-4 text-center text-xs text-[var(--accent)]">v{info.version}</p>
        {info.releaseNotes && (
          <div className="mb-4 rounded-md bg-[var(--surface-raised)] p-3 text-[11px] text-[var(--fg-muted)] leading-relaxed max-h-28 overflow-y-auto">
            {info.releaseNotes}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--fg-muted)]">
            나중에
          </button>
          <button onClick={() => void handleUpdate()}
            className="flex-[2] rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]">
            지금 업데이트
          </button>
        </div>
      </div>
    </div>
  )
}
