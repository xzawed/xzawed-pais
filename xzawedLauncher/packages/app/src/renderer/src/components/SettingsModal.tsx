import { useState, useEffect } from 'react'

interface Props { onClose: () => void }

export default function SettingsModal({ onClose }: Readonly<Props>) {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void globalThis.launcherAPI!.tokenGet().then((k) => { if (k) setApiKey(k) })
  }, [])

  async function handleSave(): Promise<void> {
    if (apiKey) await globalThis.launcherAPI!.tokenSet(apiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-96 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">⚙️ 설정</h3>
          <button onClick={onClose} className="text-[var(--fg-muted)] hover:text-[var(--fg)]">✕</button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="settings-api-key" className="mb-1 block text-xs font-semibold text-[var(--fg-muted)]">Anthropic API 키 (선택)</label>
            <input id="settings-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]" />
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--fg-muted)]">취소</button>
          <button onClick={() => void handleSave()} className="flex-[2] rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white">
            {saved ? '저장됨 ✓' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
