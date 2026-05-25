import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

const base = { WORKSPACE_ROOT: '/workspace' }

describe('loadConfig', () => {
  it('parses required fields', () => {
    const cfg = loadConfig(base)
    expect(cfg.workspaceRoot).toBe('/workspace')
  })

  it('applies defaults', () => {
    const cfg = loadConfig(base)
    expect(cfg.port).toBe(3007)
    expect(cfg.mode).toBe('local')
    expect(cfg.maxWatchers).toBe(10)
    expect(cfg.debounceMs).toBe(300)
    expect(cfg.redisUrl).toBe('redis://localhost:6379')
  })

  it('throws when WORKSPACE_ROOT is missing', () => {
    expect(() => loadConfig({})).toThrow()
  })

  it('overrides MAX_WATCHERS', () => {
    const cfg = loadConfig({ ...base, MAX_WATCHERS: '50' })
    expect(cfg.maxWatchers).toBe(50)
  })

  it('overrides DEBOUNCE_MS', () => {
    const cfg = loadConfig({ ...base, DEBOUNCE_MS: '100' })
    expect(cfg.debounceMs).toBe(100)
  })
})
