import { describe, it, expect, beforeEach } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    delete process.env.PORT
    delete process.env.CLAUDE_MODE
    delete process.env.REDIS_URL
    delete process.env.ANTHROPIC_API_KEY
  })

  it('defaults PORT to 3000', async () => {
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.port).toBe(3000)
  })

  it('reads PORT from env', async () => {
    process.env.PORT = '4000'
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.port).toBe(4000)
  })

  it('defaults CLAUDE_MODE to cli', async () => {
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.claudeMode).toBe('cli')
  })

  it('throws when CLAUDE_MODE=api but ANTHROPIC_API_KEY missing', async () => {
    process.env.CLAUDE_MODE = 'api'
    delete process.env.ANTHROPIC_API_KEY
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('ANTHROPIC_API_KEY')
  })

  it('defaults MANAGER_URL to http://localhost:3001', async () => {
    delete process.env.MANAGER_URL
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.managerUrl).toBe('http://localhost:3001')
  })
})
