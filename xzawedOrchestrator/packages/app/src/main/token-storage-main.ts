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

/**
 * OS 암호화 저장소가 없으면 평문으로 쓴다 — 그래야 로그인이 동작한다.
 *
 * 문제는 그게 조용하다는 것이었다. 파일명이 `.enc`라 운영자는 암호화됐다고 믿는다.
 * 기능은 유지하되 한 번은 크게 알린다. Windows·macOS에서는 보통 이 갈래에 오지 않고,
 * 키링 없는 Linux가 주 대상이다.
 */
let warnedPlaintext = false

function writeEncryptedToken(filePath: string, token: string): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  if (!encryptionAvailable && !warnedPlaintext) {
    warnedPlaintext = true
    // eslint-disable-next-line no-console
    console.warn(
      '[token-storage] OS 암호화 저장소를 쓸 수 없어 토큰을 평문으로 저장합니다. ' +
      '파일 확장자가 .enc여도 암호화되지 않습니다: ' + dir,
    )
  }
  const data = encryptionAvailable
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
