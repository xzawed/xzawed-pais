import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../main/index.js'

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),
})
