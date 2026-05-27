import { describe, it, expect, beforeEach } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    delete process.env.PORT
    delete process.env.CLAUDE_MODE
    delete process.env.REDIS_URL
    process.env.ANTHROPIC_API_KEY = 'sk-test-key' // NOSONAR
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

  it('defaults CLAUDE_MODE to api', async () => {
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.claudeMode).toBe('api')
  })

  it('throws when CLAUDE_MODE=api but ANTHROPIC_API_KEY missing', async () => {
    process.env.CLAUDE_MODE = 'api'
    delete process.env.ANTHROPIC_API_KEY  // NOSONAR
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('ANTHROPIC_API_KEY')
  })

  it('CLAUDE_MODE=remote + REMOTE_HOST 있지만 REMOTE_USER 없으면 throw', async () => {
    process.env.CLAUDE_MODE = 'remote'
    process.env.REMOTE_HOST = 'my-server.example.com'
    delete process.env.REMOTE_CLI_URL
    delete process.env.REMOTE_USER
    delete process.env.REMOTE_KEY_PATH
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('SSH mode requires')
    delete process.env.REMOTE_HOST
  })

  it('CLAUDE_MODE=remote + SSH 변수 모두 설정 — throw 없음', async () => {
    process.env.CLAUDE_MODE = 'remote'
    process.env.REMOTE_HOST = 'my-server.example.com'
    process.env.REMOTE_USER = 'ubuntu'
    process.env.REMOTE_KEY_PATH = '/home/user/.ssh/id_rsa'
    delete process.env.REMOTE_CLI_URL
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.claudeMode).toBe('remote')
    delete process.env.REMOTE_HOST
    delete process.env.REMOTE_USER
    delete process.env.REMOTE_KEY_PATH
  })
})
