import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptToken, decryptToken } from './github-token.crypto.js'

function makeKey(): string {
  return randomBytes(32).toString('base64')
}

describe('github-token crypto', () => {
  it('round-trips a token', () => {
    const key = makeKey()
    const token = 'ghp_testtoken1234567890'
    const encrypted = encryptToken(token, key)
    expect(decryptToken(encrypted, key)).toBe(token)
  })

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const key = makeKey()
    const token = 'ghp_sameinput'
    const a = encryptToken(token, key)
    const b = encryptToken(token, key)
    expect(a.cipher).not.toEqual(b.cipher)
    expect(a.iv).not.toEqual(b.iv)
  })

  it('throws on wrong key length', () => {
    const badKey = Buffer.from('short').toString('base64')
    expect(() => encryptToken('token', badKey)).toThrow('32 bytes')
  })

  it('throws on tampered ciphertext', () => {
    const key = makeKey()
    const encrypted = encryptToken('ghp_original', key)
    encrypted.cipher[0] ^= 0xff
    expect(() => decryptToken(encrypted, key)).toThrow()
  })

  it('throws on tampered auth tag', () => {
    const key = makeKey()
    const encrypted = encryptToken('ghp_original', key)
    encrypted.tag[0] ^= 0xff
    expect(() => decryptToken(encrypted, key)).toThrow()
  })
})
