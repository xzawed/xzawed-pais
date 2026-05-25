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
    expect(cfg.port).toBe(3005)
    expect(cfg.testTimeoutMs).toBe(60_000)
    expect(cfg.mode).toBe('local')
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({ WORKSPACE_ROOT: '/workspace' })).toThrow()
  })

  it('throws when WORKSPACE_ROOT is missing', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toThrow()
  })

  it('overrides TEST_TIMEOUT_MS', () => {
    const cfg = loadConfig({ ...base, TEST_TIMEOUT_MS: '30000' })
    expect(cfg.testTimeoutMs).toBe(30_000)
  })
})
