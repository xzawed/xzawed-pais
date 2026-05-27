import { useState, useEffect } from 'react'

interface Props { onClose: () => void }

export default function SettingsModal({ onClose }: Readonly<Props>) {
  const [hasKey, setHasKey] = useState(false)
  const [changing, setChanging] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void globalThis.launcherAPI!.tokenHas().then((v) => { setHasKey(v) })
  }, [])

  async function handleSave(): Promise<void> {
    setError(null)
    if (newKey) {
      const result = await globalThis.launcherAPI!.tokenSet(newKey)
      if (!result.success) {
        setError(result.error ?? '저장 실패')
        return
      }
      setHasKey(true)
    } else {
      await globalThis.launcherAPI!.tokenClear?.()
      setHasKey(false)
    }
    setChanging(false)
    setNewKey('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-96 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">설정</h3>
          <button onClick={onClose} className="text-[var(--fg-muted)] hover:text-[var(--fg)]">X</button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--fg-muted)]">Anthropic API 키 (선택)</label>
            {!changing && hasKey ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg-muted)]">
                  저장됨 (••••••••)
                </span>
                <button
                  onClick={() => setChanging(true)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
                >
                  변경
                </button>
                <button
                  onClick={() => {
                    void globalThis.launcherAPI!.tokenClear?.().then(() => { setHasKey(false) })
                  }}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-red-400 hover:text-red-300"
                >
                  삭제
                </button>
              </div>
            ) : (
              <input
                id="settings-api-key"
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]"
              />
            )}
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--fg-muted)]">취소</button>
          {(!hasKey || changing) && (
            <button onClick={() => void handleSave()} className="flex-[2] rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white">
              {saved ? '저장됨' : '저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
