import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'

const TOKEN_FILE = 'auth-token.enc'
const REFRESH_TOKEN_FILE = 'refresh-token.enc'

export function getTokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE)
}

export function getRefreshTokenPath(): string {
  return join(app.getPath('userData'), REFRESH_TOKEN_FILE)
}

export function readEncryptedToken(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const encrypted = readFileSync(filePath)
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encrypted)
      : encrypted.toString('utf-8')
  } catch {
    return null
  }
}

export function writeEncryptedToken(filePath: string, token: string): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf-8')
  writeFileSync(filePath, data)
}

export function deleteFileIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    try { unlinkSync(filePath) } catch { /* ignore */ }
  }
}
