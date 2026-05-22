import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
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
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as Record<string, unknown>
    // Decrypt githubToken if stored as encrypted base64
    if (typeof raw['githubTokenEnc'] === 'string') {
      try {
        const buf = Buffer.from(raw['githubTokenEnc'] as string, 'base64')
        raw['githubToken'] = safeStorage.decryptString(buf)
      } catch { /* decryption failed — omit token */ }
      delete raw['githubTokenEnc']
    }
    return raw as unknown as SetupConfig
  } catch {
    return null
  }
}

export function saveSetupConfig(config: SetupConfig): void {
  const p = configPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  // Encrypt githubToken before writing to disk
  const stored: Record<string, unknown> = { claudeMode: config.claudeMode, completedAt: config.completedAt }
  if (config.githubToken) {
    try {
      const enc = safeStorage.encryptString(config.githubToken)
      stored['githubTokenEnc'] = enc.toString('base64')
    } catch {
      // safeStorage unavailable (e.g. headless test env) — omit token rather than store plaintext
    }
  }
  fs.writeFileSync(p, JSON.stringify(stored))
}
