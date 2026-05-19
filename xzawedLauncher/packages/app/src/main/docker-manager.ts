import { exec, spawn } from 'node:child_process'
import path from 'node:path'
import { app, shell } from 'electron'
import type { DockerInstallStatus, ServiceName, ServiceState, ServiceStatus } from '@xzawed/launcher-shared'

const COMPOSE_FILE = path.join(process.resourcesPath ?? app.getAppPath(), 'docker-compose.prod.yml')

function execAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, result) => {
      if (err) reject(err)
      else resolve(typeof result === 'string' ? result : result.stdout)
    })
  })
}

export async function checkDocker(): Promise<DockerInstallStatus> {
  try {
    const out = await execAsync('docker info')
    return out.includes('Server') ? 'running' : 'installed-stopped'
  } catch {
    try {
      await execAsync('docker --version')
      return 'installed-stopped'
    } catch {
      return 'not-installed'
    }
  }
}

export async function startDockerDesktop(): Promise<void> {
  const cmds: Record<string, string> = {
    win32: 'start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
    darwin: 'open -a Docker',
    linux: 'systemctl --user start docker-desktop',
  }
  const cmd = cmds[process.platform] ?? cmds.linux
  await execAsync(cmd).catch(() => {})
}

export async function installDocker(): Promise<void> {
  const urls: Record<string, string> = {
    win32: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
    darwin: 'https://desktop.docker.com/mac/main/arm64/Docker.dmg',
    linux: 'https://docs.docker.com/engine/install/',
  }
  await shell.openExternal(urls[process.platform] ?? urls.linux)
}

export async function startAllServices(onLog: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d'], { shell: false })
    proc.stdout.on('data', (d: Buffer) => onLog(d.toString()))
    proc.stderr.on('data', (d: Buffer) => onLog(d.toString()))
    proc.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
  })
}

export async function stopAllServices(): Promise<void> {
  await execAsync(`docker compose -f "${COMPOSE_FILE}" down`)
}

export async function restartAllServices(onLog: (line: string) => void): Promise<void> {
  await stopAllServices()
  await startAllServices(onLog)
}

export async function restartService(name: string): Promise<void> {
  await execAsync(`docker compose -f "${COMPOSE_FILE}" restart ${name}`)
}

export async function stopService(name: string): Promise<void> {
  await execAsync(`docker compose -f "${COMPOSE_FILE}" stop ${name}`)
}

export async function getServiceStatuses(): Promise<ServiceState[]> {
  const PORT_MAP: Partial<Record<ServiceName, number>> = {
    orchestrator: 3000, manager: 3001, planner: 3002,
    developer: 3003, designer: 3004, tester: 3005,
    builder: 3006, watcher: 3007, security: 3008,
  }
  try {
    const out = await execAsync(`docker compose -f "${COMPOSE_FILE}" ps --format json`)
    const rows = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    return rows.map((r: { Name: string; State: string; Health: string }) => {
      const name = r.Name.replace(/^xzawed[_-]/, '').replace(/[_-]\d+$/, '') as ServiceName
      let status: ServiceStatus = 'stopped'
      if (r.State === 'running' && r.Health === 'healthy') status = 'running'
      else if (r.State === 'running') status = 'starting'
      else if (r.State === 'restarting') status = 'restarting'
      else if (r.State === 'exited') status = 'error'
      return { name, status, port: PORT_MAP[name] }
    })
  } catch {
    return []
  }
}
