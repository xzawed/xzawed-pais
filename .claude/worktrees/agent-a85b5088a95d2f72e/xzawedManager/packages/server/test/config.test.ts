import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns parsed config when all required vars are set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.MODE = 'local'
    const config = loadConfig()
    expect(config.ANTHROPIC_API_KEY).toBe('sk-test-key')
    expect(config.PORT).toBe(3001)
    expect(config.CLAUDE_MODEL).toBe('claude-sonnet-4-6')
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.MODE = 'local'
    expect(() => loadConfig()).toThrow()
  })
})
