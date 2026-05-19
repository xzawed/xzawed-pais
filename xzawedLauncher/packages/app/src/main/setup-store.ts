import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { SetupConfig } from '@xzawed/launcher-shared'

function configPath(): string {
  return path.join(app.getPath('userData'), 'setup-complete.json')
}

export function isSetupComplete(): boolean {
  try {
    return fs.existsSync(configPath())
  } catch {
    return false
  }
}

export function getSetupConfig(): SetupConfig | null {
  try {
    if (!fs.existsSync(configPath())) return null
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as SetupConfig
  } catch {
    return null
  }
}

export function saveSetupConfig(config: SetupConfig): void {
  const p = configPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(config))
}
