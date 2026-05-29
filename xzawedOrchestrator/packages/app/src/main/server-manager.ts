import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'

export class ServerManager {
  private proc: ChildProcess | null = null

  start(): void {
    // Packaged: <install>/resources/app.asar → ../../server = <install>/server
    // Dev mode: packages/app → ../server = packages/server
    const serverDir = app.isPackaged
      ? join(app.getAppPath(), '..', '..', 'server')
      : join(app.getAppPath(), '..', 'server')
    const entry = join(serverDir, 'dist', 'index.js')

    this.proc = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        // ELECTRON_RUN_AS_NODE makes the electron binary run the script as Node.js
        ELECTRON_RUN_AS_NODE: '1',
        PORT: process.env['PORT'] ?? '3000',
        MODE: process.env['MODE'] ?? 'local',
        AUTH: process.env['AUTH'] ?? 'none',
        CLAUDE_MODE: process.env['CLAUDE_MODE'] ?? 'api',
        CLAUDE_MODEL: process.env['CLAUDE_MODEL'] ?? 'claude-sonnet-4-6',
        REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
        WORKSPACE_ROOT: process.env['WORKSPACE_ROOT'] ?? '/workspace',
        MANAGER_URL: process.env['MANAGER_URL'] ?? 'http://localhost:3001',
      },
      stdio: 'inherit',
      shell: false,
    })

    this.proc.on('error', (err) => {
      console.error('[ServerManager] failed to start server:', err.message)
    })
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }
}
