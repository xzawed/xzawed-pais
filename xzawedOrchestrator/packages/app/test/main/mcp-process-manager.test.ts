import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(function () { return ({
    pid: 1234,
    on: vi.fn(),
    once: vi.fn((_event: string, cb: () => void) => { cb() }),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }) }),
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
  mkdirSync: vi.fn(),
}))
vi.mock('electron', () => ({ // NOSONAR
  app: { getPath: vi.fn(() => '/tmp/test') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((v: string) => Buffer.from('enc:' + v)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
}))

import { McpProcessManager, buildChildEnv } from '../../src/main/mcp-process-manager.js'

describe('McpProcessManager', () => {
  let manager: McpProcessManager

  beforeEach(() => { manager = new McpProcessManager() })
  afterEach(() => manager.stopAll())

  it('서버를 추가하고 목록에 반환한다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    expect(manager.listServers()).toHaveLength(1)
    expect(manager.listServers()[0].id).toBe('ctx7')
  })

  it('서버를 시작하면 status가 running이 된다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.startServer('ctx7')
    expect(manager.getStatus('ctx7')).toBe('running')
  })

  it('서버를 제거하면 목록에서 사라진다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.removeServer('ctx7')
    expect(manager.listServers()).toHaveLength(0)
  })

  it('등록되지 않은 서버를 시작하면 throw', async () => {
    await expect(manager.startServer('nonexistent')).rejects.toThrow('MCP server not found: nonexistent')
  })

  it('이미 실행 중인 서버는 spawn을 다시 호출하지 않는다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.startServer('ctx7')
    const callsBefore = vi.mocked(spawn).mock.calls.length
    await manager.startServer('ctx7')
    expect(vi.mocked(spawn).mock.calls.length).toBe(callsBefore)
  })

  it('허용되지 않은 command는 throw', async () => {
    await manager.addServer({ id: 's1', name: 's1', command: 'bash', args: [], env: {}, autoStart: false })
    await expect(manager.startServer('s1')).rejects.toThrow('MCP command not allowed: bash')
  })

  it('node -e 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's1', name: 's1', command: 'node', args: ['-e', 'process.exit()'], env: {}, autoStart: false })
    await expect(manager.startServer('s1')).rejects.toThrow("Argument '-e' is not permitted")
  })

  it('https:// URL arg는 throw', async () => {
    await manager.addServer({ id: 's1', name: 's1', command: 'npx', args: ['https://evil.com/payload.ts'], env: {}, autoStart: false })
    await expect(manager.startServer('s1')).rejects.toThrow('URL arguments are not permitted')
  })

  it('http:// URL arg는 throw', async () => {
    await manager.addServer({ id: 's2', name: 's2', command: 'npx', args: ['http://evil.com/pkg'], env: {}, autoStart: false })
    await expect(manager.startServer('s2')).rejects.toThrow('URL arguments are not permitted')
  })

  it('file:// URL arg는 throw', async () => {
    await manager.addServer({ id: 's3', name: 's3', command: 'deno', args: ['file:///etc/passwd'], env: {}, autoStart: false })
    await expect(manager.startServer('s3')).rejects.toThrow('URL arguments are not permitted')
  })

  it('data: URL arg는 throw', async () => {
    await manager.addServer({ id: 's4', name: 's4', command: 'npx', args: ['data://text/plain,evil'], env: {}, autoStart: false })
    await expect(manager.startServer('s4')).rejects.toThrow('URL arguments are not permitted')
  })

  it('javascript: URL arg는 throw', async () => {
    await manager.addServer({ id: 's5', name: 's5', command: 'npx', args: ['javascript://alert(1)'], env: {}, autoStart: false })
    await expect(manager.startServer('s5')).rejects.toThrow('URL arguments are not permitted')
  })

  it('ftp:// URL arg는 throw', async () => {
    await manager.addServer({ id: 's6', name: 's6', command: 'npx', args: ['ftp://example.com/file'], env: {}, autoStart: false })
    await expect(manager.startServer('s6')).rejects.toThrow('URL arguments are not permitted')
  })

  it('차단된 env 키는 throw', async () => {
    await manager.addServer({ id: 's1', name: 's1', command: 'npx', args: ['safe-pkg'], env: { PATH: '/evil' }, autoStart: false })
    await expect(manager.startServer('s1')).rejects.toThrow("Environment variable 'PATH' cannot be overridden")
  })

  it('stopServer — 프로세스 없으면 즉시 return', async () => {
    await expect(manager.stopServer('nonexistent')).resolves.toBeUndefined()
  })

  it('getStatuses — 실행 중 서버 상태 반환', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.startServer('ctx7')
    expect(manager.getStatuses()['ctx7']).toBe('running')
  })

  it('autoStart:true 서버는 addServer 시 자동 시작', async () => {
    await manager.addServer({ id: 'auto', name: 'auto', command: 'npx', args: ['auto-pkg'], env: {}, autoStart: true })
    expect(manager.getStatus('auto')).toBe('running')
  })

  it('stopServer가 3초 내 종료 안 하면 SIGKILL을 보낸다', async () => {
    vi.useFakeTimers()
    const mockKill = vi.fn()
    vi.mocked(spawn).mockReturnValueOnce({
      pid: 9999,
      on: vi.fn(),
      once: vi.fn(), // exit cb를 호출하지 않음 — 타임아웃까지 프로세스 유지
      kill: mockKill,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    } as unknown as ReturnType<typeof spawn>)

    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.startServer('ctx7')

    const stopPromise = manager.stopServer('ctx7')
    await vi.advanceTimersByTimeAsync(3000)
    await stopPromise

    expect(mockKill).toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })

  // BLOCKED_ARG_PATTERNS 완성 검증
  it('npx --yes 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's1', name: 's1', command: 'npx', args: ['--yes', 'some-pkg'], env: {}, autoStart: false })
    await expect(manager.startServer('s1')).rejects.toThrow("Argument '--yes' is not permitted")
  })

  it('npx -y 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's2', name: 's2', command: 'npx', args: ['-y', 'some-pkg'], env: {}, autoStart: false })
    await expect(manager.startServer('s2')).rejects.toThrow("Argument '-y' is not permitted")
  })

  it('npx --package 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's3', name: 's3', command: 'npx', args: ['--package', 'evil'], env: {}, autoStart: false })
    await expect(manager.startServer('s3')).rejects.toThrow("Argument '--package' is not permitted")
  })

  it('deno run 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's4', name: 's4', command: 'deno', args: ['run', 'script.ts'], env: {}, autoStart: false })
    await expect(manager.startServer('s4')).rejects.toThrow("Argument 'run' is not permitted")
  })

  it('deno eval 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's5', name: 's5', command: 'deno', args: ['eval', 'console.log(1)'], env: {}, autoStart: false })
    await expect(manager.startServer('s5')).rejects.toThrow("Argument 'eval' is not permitted")
  })

  it('deno --allow-all 위험 플래그는 throw', async () => {
    await manager.addServer({ id: 's6', name: 's6', command: 'deno', args: ['--allow-all', 'script.ts'], env: {}, autoStart: false })
    await expect(manager.startServer('s6')).rejects.toThrow("Argument '--allow-all' is not permitted")
  })

  it('node index.js 정상 인수는 pass', async () => {
    await manager.addServer({ id: 's7', name: 's7', command: 'node', args: ['index.js'], env: {}, autoStart: false })
    await expect(manager.startServer('s7')).resolves.toBeUndefined()
  })

  // Zod 검증: 잘못된 config 파일은 빈 배열 반환
  it('load() — 잘못된 JSON config 무시하고 빈 배열 반환', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('[{"id":"","name":"","command":""}]') // id/name/command 빈 문자열 — Zod 검증 실패
    const freshManager = new McpProcessManager()
    expect(freshManager.listServers()).toHaveLength(0)
  })

  it('stopAll() — Promise<void>를 반환하여 await 가능하다', async () => {
    vi.useFakeTimers()
    // spawn mock: once('exit') cb를 즉시 호출 → 정상 종료
    vi.mocked(spawn).mockReturnValue({
      pid: 1111,
      on: vi.fn(),
      once: vi.fn((_event: string, cb: () => void) => { cb() }),
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    } as unknown as ReturnType<typeof spawn>)

    await manager.addServer({ id: 'a', name: 'a', command: 'npx', args: ['pkg-a'], env: {}, autoStart: false })
    await manager.addServer({ id: 'b', name: 'b', command: 'npx', args: ['pkg-b'], env: {}, autoStart: false })
    await manager.startServer('a')
    await manager.startServer('b')

    // stopAll()이 Promise<void>여야 함 — resolves.toBeUndefined()로 검증
    await expect(manager.stopAll()).resolves.toBeUndefined()

    vi.useRealTimers()
  })

  it('stopServer() settled 플래그 — exit 이벤트 후 타이머 만료 시 SIGKILL 전송 안 함', async () => {
    vi.useFakeTimers()
    const mockKill = vi.fn()
    let exitCb: (() => void) | undefined

    vi.mocked(spawn).mockReturnValueOnce({
      pid: 2222,
      on: vi.fn(),
      once: vi.fn((event: string, cb: () => void) => {
        if (event === 'exit') exitCb = cb
      }),
      kill: mockKill,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    } as unknown as ReturnType<typeof spawn>)

    await manager.addServer({ id: 'c', name: 'c', command: 'npx', args: ['pkg-c'], env: {}, autoStart: false })
    await manager.startServer('c')

    const stopPromise = manager.stopServer('c')
    // exit 이벤트를 먼저 발생시킨 뒤 3초 타이머 실행
    exitCb?.()
    await vi.advanceTimersByTimeAsync(3000)
    await stopPromise

    // SIGTERM은 전송, exit 이후에는 SIGKILL 전송 안 됨
    expect(mockKill).toHaveBeenCalledWith('SIGTERM')
    expect(mockKill).not.toHaveBeenCalledWith('SIGKILL')

    vi.useRealTimers()
  })
})

describe('buildChildEnv (MCP 자식에 물려줄 환경)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, saved)
  })

  it('허용 목록에 없는 부모 env는 물려주지 않는다 — 서드파티 MCP에 비밀이 새면 안 된다', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-secret'
    process.env['GITHUB_CLIENT_SECRET'] = 'ghs-secret'
    process.env['AWS_SECRET_ACCESS_KEY'] = 'aws-secret'
    const env = buildChildEnv({})
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['GITHUB_CLIENT_SECRET']).toBeUndefined()
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined()
  })

  it('실행에 필요한 키는 물려준다', () => {
    process.env['PATH'] = '/usr/bin'
    process.env['HOME'] = '/home/u'
    const env = buildChildEnv({})
    expect(env['PATH']).toBe('/usr/bin')
    expect(env['HOME']).toBe('/home/u')
  })

  it('config.env는 그대로 실린다 — 서버가 필요한 값은 사용자가 명시하는 통로다', () => {
    const env = buildChildEnv({ SUPABASE_KEY: 'sb-123' })
    expect(env['SUPABASE_KEY']).toBe('sb-123')
  })

  it('부모에 없는 키는 undefined로 채우지 않는다', () => {
    delete process.env['NO_PROXY']
    const env = buildChildEnv({})
    expect('NO_PROXY' in env).toBe(false)
  })

  it('config.env가 undefined여도 동작한다', () => {
    expect(() => buildChildEnv(undefined)).not.toThrow()
  })
})

describe('mcp-servers.json env 봉인', () => {
  it('저장 시 env 값이 평문으로 남지 않는다', async () => {
    const fsMod = await import('node:fs')
    const write = vi.mocked(fsMod.writeFileSync)
    write.mockClear()
    const m = new McpProcessManager()
    await m.addServer({
      id: 'x', name: 'supa', command: 'npx', args: ['@supabase/mcp-server-supabase'],
      env: { SUPABASE_KEY: 'super-secret-value' }, autoStart: false,
    } as never)
    const written = String(write.mock.calls.at(-1)?.[1] ?? '')
    expect(written).not.toContain('super-secret-value')
    expect(written).toContain('enc:v1:')
  })

  it('읽을 때 봉인된 값을 되돌린다 — 기존 평문 값은 그대로 통과', async () => {
    const fsMod = await import('node:fs')
    const sealed = 'enc:v1:' + Buffer.from('enc:sealed-value').toString('base64')
    vi.mocked(fsMod.existsSync).mockReturnValue(true)
    vi.mocked(fsMod.readFileSync).mockReturnValue(JSON.stringify([{
      id: 'x', name: 'n', command: 'npx', args: [],
      env: { SEALED: sealed, LEGACY: 'plain-old' }, autoStart: false,
    }]) as never)
    try {
      const m = new McpProcessManager()
      const cfg = m.listServers().find((c) => c.id === 'x')
      expect(cfg?.env['SEALED']).toBe('sealed-value')
      expect(cfg?.env['LEGACY']).toBe('plain-old')
    } finally {
      vi.mocked(fsMod.existsSync).mockReturnValue(false)
      vi.mocked(fsMod.readFileSync).mockReturnValue('[]' as never)
    }
  })
})
