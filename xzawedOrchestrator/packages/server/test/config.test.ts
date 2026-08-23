import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
    delete process.env.ALLOWED_ORIGINS
    delete process.env.TRUST_PROXY
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

describe('config — 원격 배포 태세 하드페일', () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS
    delete process.env.TRUST_PROXY
  })

  it('MODE=remote 이고 AUTH=none 이면 기동을 거부한다', async () => {
    process.env.MODE = 'remote'
    process.env.AUTH = 'none'
    process.env.SERVICE_JWT_SECRET = 'x'.repeat(32)
    process.env.USER_JWT_SECRET = 'y'.repeat(32)
    process.env.ALLOWED_ORIGINS = 'https://app.example.com'
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow(/AUTH/)
  })

  it('MODE=remote 인데 ALLOWED_ORIGINS 가 비면 기동을 거부한다', async () => {
    process.env.MODE = 'remote'
    process.env.AUTH = 'jwt'
    process.env.SERVICE_JWT_SECRET = 'x'.repeat(32)
    process.env.USER_JWT_SECRET = 'y'.repeat(32)
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow(/ALLOWED_ORIGINS/)
  })

  it('MODE=remote + AUTH=jwt + ALLOWED_ORIGINS 면 기동한다', async () => {
    process.env.MODE = 'remote'
    process.env.AUTH = 'jwt'
    process.env.SERVICE_JWT_SECRET = 'x'.repeat(32)
    process.env.USER_JWT_SECRET = 'y'.repeat(32)
    process.env.ALLOWED_ORIGINS = 'https://app.example.com, https://admin.example.com'
    const { loadConfig } = await import('../src/config.js')
    const c = loadConfig()
    expect(c.allowedOrigins).toEqual(['https://app.example.com', 'https://admin.example.com'])
  })

  it('MODE=local 은 AUTH=none 을 그대로 허용한다 — 로컬 단일 사용자 전제', async () => {
    process.env.MODE = 'local'
    process.env.AUTH = 'none'
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).not.toThrow()
  })
})

describe('config — trustProxy', () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY
    delete process.env.ALLOWED_ORIGINS
  })

  it('기본은 false — 프록시 뒤가 아니면 X-Forwarded-For 를 믿지 않는다', async () => {
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().trustProxy).toBe(false)
  })

  it('TRUST_PROXY=true 로만 켤 수 있다', async () => {
    process.env.TRUST_PROXY = 'true'
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().trustProxy).toBe(true)
  })

  it('아무 값이나 true 로 해석하지 않는다', async () => {
    process.env.TRUST_PROXY = '1'
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().trustProxy).toBe(false)
  })
})

describe('ANTHROPIC_API_KEY_FILE — compose secret 수령', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orch-secret-'))
    process.env.CLAUDE_MODE = 'api'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY_FILE
  })
  afterEach(async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY_FILE
    delete process.env.CLAUDE_MODE
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('파일로 준 키가 CLAUDE_MODE=api 하드페일을 만족시킨다', async () => {
    // 이 규칙이 env 만 보면, compose secret 으로 키를 준 배포가 기동을 거부당한다.
    const p = path.join(dir, 'key')
    await fsp.writeFile(p, 'sk-ant-from-secret\n', 'utf-8')
    process.env.ANTHROPIC_API_KEY_FILE = p
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().anthropicApiKey).toBe('sk-ant-from-secret')
  })

  it('_FILE 이 env 보다 우선한다', async () => {
    const p = path.join(dir, 'key')
    await fsp.writeFile(p, 'sk-from-file', 'utf-8')
    process.env.ANTHROPIC_API_KEY = 'sk-inline'
    process.env.ANTHROPIC_API_KEY_FILE = p
    const { loadConfig } = await import('../src/config.js')
    expect(loadConfig().anthropicApiKey).toBe('sk-from-file')
  })

  it('_FILE 이 읽히지 않으면 기동을 거부한다 — env 로 조용히 폴백하지 않는다', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-inline'
    process.env.ANTHROPIC_API_KEY_FILE = path.join(dir, 'missing')
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow(/ANTHROPIC_API_KEY_FILE/)
  })
})
