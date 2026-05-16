import React, { useState } from 'react'
import { useAppStore, type AppSettings } from '../store/app.store.js'

export function SettingsModal(): React.JSX.Element | null {
  const { settings, showSettings, toggleSettings, updateSettings } = useAppStore()
  const [draft, setDraft] = useState<AppSettings>({ ...settings })

  if (!showSettings) return null

  function handleSave(): void {
    updateSettings(draft)
    // Persist via IPC if electronAPI is available
    window.electronAPI?.setSettings(draft).catch(console.error)
    toggleSettings()
  }

  function handleCancel(): void {
    setDraft({ ...settings })
    toggleSettings()
  }

  return (
    <div className="settings-overlay" onClick={handleCancel}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-field">
          <label>Server URL</label>
          <input
            type="text"
            value={draft.serverUrl}
            onChange={(e) => setDraft((d) => ({ ...d, serverUrl: e.target.value }))}
            placeholder="http://localhost:3000"
          />
        </div>

        <div className="settings-field">
          <label>Mode</label>
          <select
            value={draft.mode}
            onChange={(e) =>
              setDraft((d) => ({ ...d, mode: e.target.value as 'local' | 'remote' }))
            }
          >
            <option value="local">Local (embedded server)</option>
            <option value="remote">Remote (external server)</option>
          </select>
        </div>

        <div className="settings-field">
          <label>User ID</label>
          <input
            type="text"
            value={draft.userId}
            onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
            placeholder="user"
          />
        </div>

        <div className="settings-modal-actions">
          <button className="btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
