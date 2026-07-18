import { describe, it, expect, beforeEach } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    delete process.env.PORT
    delete process.env.MODE
    delete process.env.AUTH
    delete process.env.CLAUDE_MODE
    delete process.env.REDIS_URL
    delete process.env.SERVICE_JWT_SECRET
    delete process.env.USER_JWT_SECRET
    delete process.env.PAIS_PROFILE
    delete process.env.ORCHESTRATOR_DECOMPOSE_ENABLED
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

  it('decomposeEnabled는 기본 false (회귀 0)', async () => {
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().decomposeEnabled).toBe(false)
  })

  it('ORCHESTRATOR_DECOMPOSE_ENABLED=true → decomposeEnabled true', async () => {
    process.env.ORCHESTRATOR_DECOMPOSE_ENABLED = 'true'
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().decomposeEnabled).toBe(true)
  })

  it('PAIS_PROFILE=autonomous → decomposeEnabled true (프리셋 병합)', async () => {
    process.env.PAIS_PROFILE = 'autonomous'
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().decomposeEnabled).toBe(true)
  })

  it('개별 env가 PAIS_PROFILE을 override (ORCHESTRATOR_DECOMPOSE_ENABLED=false)', async () => {
    process.env.PAIS_PROFILE = 'autonomous'
    process.env.ORCHESTRATOR_DECOMPOSE_ENABLED = 'false'
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().decomposeEnabled).toBe(false)
  })

  it('미지 PAIS_PROFILE은 기동 거부(명확한 에러)', async () => {
    process.env.PAIS_PROFILE = 'bogus'
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow(/Unknown PAIS_PROFILE/)
  })

  it('resolveProfileEnv: 미설정→동일 참조 반환·미지 프로필→throw', async () => {
    const { resolveProfileEnv } = await import('../src/config.js')
    const env = { FOO: 'bar' } as NodeJS.ProcessEnv
    expect(resolveProfileEnv(env)).toBe(env)
    expect(() => resolveProfileEnv({ PAIS_PROFILE: 'bogus' } as NodeJS.ProcessEnv)).toThrow(
      /Unknown PAIS_PROFILE/,
    )
  })
})
