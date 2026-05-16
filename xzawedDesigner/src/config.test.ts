import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

const base = { ANTHROPIC_API_KEY: 'sk-test-key' }

describe('loadConfig', () => {
  it('parses required fields', () => {
    const cfg = loadConfig(base)
    expect(cfg.anthropicApiKey).toBe('sk-test-key')
  })

  it('applies defaults', () => {
    const cfg = loadConfig(base)
    expect(cfg.port).toBe(3004)
    expect(cfg.mode).toBe('local')
    expect(cfg.redisUrl).toBe('redis://localhost:6379')
    expect(cfg.claudeModel).toBe('claude-sonnet-4-6')
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({})).toThrow()
  })

  it('overrides defaults with env values', () => {
    const cfg = loadConfig({ ...base, PORT: '3099', MODE: 'remote' })
    expect(cfg.port).toBe(3099)
    expect(cfg.mode).toBe('remote')
  })

  it('throws on invalid MODE', () => {
    expect(() => loadConfig({ ...base, MODE: 'invalid' })).toThrow()
  })
})
