import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'

const TOKEN_FILE = 'auth-token.enc'
const REFRESH_TOKEN_FILE = 'refresh-token.enc'

function getTokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE)
}

function getRefreshTokenPath(): string {
  return join(app.getPath('userData'), REFRESH_TOKEN_FILE)
}

function readEncryptedToken(filePath: string): string | null {
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

function writeEncryptedToken(filePath: string, token: string): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf-8')
  writeFileSync(filePath, data)
}

function deleteFileIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    try { unlinkSync(filePath) } catch { /* ignore */ }
  }
}

export function readToken(): string | null {
  return readEncryptedToken(getTokenPath())
}

export function writeToken(token: string): void {
  writeEncryptedToken(getTokenPath(), token)
}

export function readRefreshToken(): string | null {
  return readEncryptedToken(getRefreshTokenPath())
}

export function writeRefreshToken(token: string): void {
  writeEncryptedToken(getRefreshTokenPath(), token)
}

export function clearTokenFiles(): void {
  deleteFileIfExists(getTokenPath())
  deleteFileIfExists(getRefreshTokenPath())
}
