import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

const base = {
  ANTHROPIC_API_KEY: 'sk-test-key',
  WORKSPACE_ROOT: '/workspace',
}

describe('loadConfig', () => {
  it('parses required fields', () => {
    const cfg = loadConfig(base)
    expect(cfg.anthropicApiKey).toBe('sk-test-key')
    expect(cfg.workspaceRoot).toBe('/workspace')
  })

  it('applies defaults', () => {
    const cfg = loadConfig(base)
    expect(cfg.port).toBe(3003)
    expect(cfg.mode).toBe('local')
    expect(cfg.redisUrl).toBe('redis://localhost:6379')
    expect(cfg.claudeModel).toBe('claude-sonnet-4-6')
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({ WORKSPACE_ROOT: '/workspace' })).toThrow()
  })

  it('throws when WORKSPACE_ROOT is missing', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toThrow()
  })

  it('overrides defaults with env values', () => {
    const cfg = loadConfig({ ...base, PORT: '3099', MODE: 'remote', REDIS_URL: 'redis://remote:6379' })
    expect(cfg.port).toBe(3099)
    expect(cfg.mode).toBe('remote')
    expect(cfg.redisUrl).toBe('redis://remote:6379')
  })
})
