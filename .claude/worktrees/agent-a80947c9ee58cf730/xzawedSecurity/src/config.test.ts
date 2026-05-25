import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

const base = { ANTHROPIC_API_KEY: 'sk-test', WORKSPACE_ROOT: '/workspace' }

describe('loadConfig', () => {
  it('parses required fields', () => {
    const cfg = loadConfig(base)
    expect(cfg.anthropicApiKey).toBe('sk-test')
    expect(cfg.workspaceRoot).toBe('/workspace')
  })

  it('applies defaults', () => {
    const cfg = loadConfig(base)
    expect(cfg.port).toBe(3008)
    expect(cfg.mode).toBe('local')
    expect(cfg.claudeModel).toBe('claude-sonnet-4-6')
    expect(cfg.redisUrl).toBe('redis://localhost:6379')
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({ WORKSPACE_ROOT: '/workspace' })).toThrow()
  })

  it('throws when WORKSPACE_ROOT is missing', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toThrow()
  })

  it('overrides PORT', () => {
    const cfg = loadConfig({ ...base, PORT: '9000' })
    expect(cfg.port).toBe(9000)
  })
})
