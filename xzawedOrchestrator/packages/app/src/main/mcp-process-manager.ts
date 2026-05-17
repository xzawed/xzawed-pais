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

export class McpProcessManager {
  private processes = new Map<string, ChildProcess>()
  private statuses  = new Map<string, McpStatus>()
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

    const proc = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
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
    proc.kill()
    this.processes.delete(id)
    this.statuses.set(id, 'stopped')
  }

  stopAll(): void {
    for (const [id] of this.processes) void this.stopServer(id)
  }

  async startAutoStart(): Promise<void> {
    for (const config of this.configs) {
      if (config.autoStart) await this.startServer(config.id)
    }
  }
}
