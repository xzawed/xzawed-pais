import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store/app.store.js'
import type { Locale } from '../lib/detect-locale.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from './ui/dialog.js'
import { Button } from './ui/button.js'

export function SettingsModal(): React.JSX.Element {
  const { settings, showSettings, toggleSettings, updateSettings, locale, setLocale } = useAppStore()
  const { t } = useTranslation('app')
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
      <DialogContent data-testid="settings-modal">
        <DialogHeader>
          <DialogTitle data-testid="settings-title">{t('settings.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="settings-server-url" className={labelClass}>{t('settings.server_url')}</label>
            <input
              id="settings-server-url"
              data-testid="settings-server-url"
              type="text"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              className={inputClass}
              placeholder="http://localhost:3000"
            />
          </div>

          <div>
            <label htmlFor="settings-mode" className={labelClass}>{t('settings.mode')}</label>
            <select
              id="settings-mode"
              data-testid="settings-mode"
              value={localMode}
              onChange={(e) => setLocalMode(e.target.value as 'local' | 'remote')}
              className={inputClass}
            >
              <option value="local">{t('settings.mode_local')}</option>
              <option value="remote">{t('settings.mode_remote')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-user-id" className={labelClass}>{t('settings.user_id')}</label>
            <input
              id="settings-user-id"
              data-testid="settings-user-id"
              type="text"
              value={localUserId}
              onChange={(e) => setLocalUserId(e.target.value)}
              className={inputClass}
              placeholder="user-id"
            />
          </div>

          <div>
            <label htmlFor="settings-language" className={labelClass}>{t('settings.language')}</label>
            <select
              id="settings-language"
              data-testid="settings-language"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className={inputClass}
            >
              <option value="ko">{t('settings.lang_ko')}</option>
              <option value="en">{t('settings.lang_en')}</option>
              <option value="ja">{t('settings.lang_ja')}</option>
            </select>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="md" data-testid="settings-cancel">{t('cancel', { ns: 'common' })}</Button>
          </DialogClose>
          <Button variant="default" size="md" data-testid="settings-save" onClick={handleSave}>{t('save', { ns: 'common' })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
