import { spawn } from 'node:child_process'
import { shell } from 'electron'
import type { ClaudeDetectStatus } from '@xzawed/launcher-shared'

function spawnAsync(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const proc = spawn(bin, args, { shell: false })
    proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
    proc.stderr.on('data', (d: Buffer) => chunks.push(d.toString()))
    proc.on('close', (code: number) => {
      if (code === 0) resolve(chunks.join(''))
      else reject(new Error(`exit ${code}`))
    })
    proc.on('error', reject)
  })
}

export async function checkClaude(): Promise<ClaudeDetectStatus> {
  try {
    const out = await spawnAsync('claude', ['whoami'])
    if (out.toLowerCase().includes('not logged in') || out.trim() === '') {
      return 'not-logged-in'
    }
    return 'logged-in'
  } catch {
    try {
      await spawnAsync('claude', ['--version'])
      return 'not-logged-in'
    } catch {
      return 'not-installed'
    }
  }
}

export async function getClaudeEmail(): Promise<string | null> {
  try {
    const out = await spawnAsync('claude', ['whoami'])
    const match = out.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function installClaude(onLog: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], { shell: false })
    proc.stdout.on('data', (d: Buffer) => onLog(d.toString()))
    proc.stderr.on('data', (d: Buffer) => onLog(d.toString()))
    proc.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`npm exit ${code}`))))
    proc.on('error', reject)
  })
}

export async function openClaudeLogin(): Promise<void> {
  await shell.openExternal('https://claude.ai/login')
}

export async function waitClaudeLogin(timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await checkClaude()
    if (status === 'logged-in') return true
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return false
}
