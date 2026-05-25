import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

export interface EncryptedToken {
  cipher: Buffer
  iv: Buffer
  tag: Buffer
}

export function encryptToken(plaintext: string, keyHex: string): EncryptedToken {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { cipher: encrypted, iv, tag }
}

export function decryptToken(encrypted: EncryptedToken, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv)
  decipher.setAuthTag(encrypted.tag)
  return decipher.update(encrypted.cipher) + decipher.final('utf8')
}
