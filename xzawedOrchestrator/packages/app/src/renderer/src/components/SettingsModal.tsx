import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/app.store.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from './ui/dialog.js'
import { Button } from './ui/button.js'

export function SettingsModal(): React.JSX.Element {
  const { settings, showSettings, toggleSettings, updateSettings } = useAppStore()
  const [localUrl, setLocalUrl] = useState(settings.serverUrl)
  const [localMode, setLocalMode] = useState(settings.mode)
  const [localUserId, setLocalUserId] = useState(settings.userId)

  useEffect(() => {
    if (showSettings) {
      setLocalUrl(settings.serverUrl)
      setLocalMode(settings.mode)
      setLocalUserId(settings.userId)
    }
  }, [showSettings, settings])

  function handleSave(): void {
    const updated = { serverUrl: localUrl, mode: localMode, userId: localUserId }
    updateSettings(updated)
    globalThis.electronAPI?.setSettings(updated).catch(console.error)
    toggleSettings()
  }

  const labelClass = 'block text-[10px] text-fg-ghost mb-1'
  const inputClass =
    'w-full rounded border border-border bg-code px-2.5 py-1.5 text-[12px] text-fg placeholder:text-fg-ghost outline-none focus:border-accent/60 transition-colors'

  return (
    <Dialog open={showSettings} onOpenChange={toggleSettings}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="settings-server-url" className={labelClass}>서버 URL</label>
            <input
              id="settings-server-url"
              type="text"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              className={inputClass}
              placeholder="http://localhost:3000"
            />
          </div>

          <div>
            <label htmlFor="settings-mode" className={labelClass}>모드</label>
            <select
              id="settings-mode"
              value={localMode}
              onChange={(e) => setLocalMode(e.target.value as 'local' | 'remote')}
              className={inputClass}
            >
              <option value="local">Local</option>
              <option value="remote">Remote</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-user-id" className={labelClass}>사용자 ID</label>
            <input
              id="settings-user-id"
              type="text"
              value={localUserId}
              onChange={(e) => setLocalUserId(e.target.value)}
              className={inputClass}
              placeholder="user-id"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="md">취소</Button>
          </DialogClose>
          <Button variant="default" size="md" onClick={handleSave}>저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
