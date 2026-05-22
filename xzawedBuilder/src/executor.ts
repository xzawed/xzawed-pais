import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

export interface ExecResult {
  success: boolean
  output: string
  exitCode: number
  duration: number
}

export async function validatePath(projectPath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)
  const realProject = await fs.realpath(projectPath).catch(() => {
    throw new Error(`경로 거부: ${projectPath} — 경로가 존재하지 않습니다`)
  })
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realProject)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${projectPath}`)
  }
  return realProject
}

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10 MiB

export async function exec(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void | Promise<void>,
  timeoutMs: number
): Promise<ExecResult> {
  const parts = command.trim().split(/\s+/)
  const bin = parts[0]
  if (!bin) throw new Error('Empty command')
  const cmdArgs = parts.slice(1)

  const startTime = Date.now()
  const chunks: string[] = []
  let totalBytes = 0

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, cmdArgs, {
      cwd,
      shell: false,
      env: { ...process.env, COREPACK_ENABLE_STRICT: '0', COREPACK_ENABLE_AUTO_PIN: '0' },
    })
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      // SIGKILL fallback: if process does not exit within 5 s after SIGTERM, force-kill
      const killTimer = setTimeout(() => { proc.kill('SIGKILL') }, 5000)
      proc.once('close', () => clearTimeout(killTimer))
      settle(() => reject(new Error(`빌드 타임아웃: ${timeoutMs}ms 초과`)))
    }, timeoutMs)

    const addChunk = (str: string) => {
      if (totalBytes >= MAX_OUTPUT_BYTES) return
      totalBytes += Buffer.byteLength(str)
      if (totalBytes > MAX_OUTPUT_BYTES) {
        chunks.push('\n[출력이 최대 크기를 초과하여 잘렸습니다]\n')
      } else {
        chunks.push(str)
      }
      Promise.resolve(onChunk(str)).catch(() => {})
    }

    proc.stdout.on('data', (chunk: Buffer) => { addChunk(chunk.toString()) })
    proc.stderr.on('data', (chunk: Buffer) => { addChunk(chunk.toString()) })

    proc.on('close', (code: number | null = 1) => {
      const exitCode = code ?? 1
      settle(() =>
        resolve({
          success: exitCode === 0,
          output: chunks.join(''),
          exitCode,
          duration: Date.now() - startTime,
        })
      )
    })

    proc.on('error', (err: Error) => {
      settle(() => reject(err))
    })
  })
}
