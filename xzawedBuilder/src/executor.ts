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
const SIGKILL_GRACE_MS = 5000

/** Collects process output up to MAX_OUTPUT_BYTES, then truncates. */
class OutputCollector {
  private readonly chunks: string[] = []
  private byteCount = 0

  feed(str: string, onChunk: (chunk: string) => void | Promise<void>): void {
    if (this.byteCount >= MAX_OUTPUT_BYTES) return
    this.byteCount += Buffer.byteLength(str)
    if (this.byteCount > MAX_OUTPUT_BYTES) {
      this.chunks.push('\n[출력이 최대 크기를 초과하여 잘렸습니다]\n')
    } else {
      this.chunks.push(str)
    }
    Promise.resolve(onChunk(str)).catch(() => {})
  }

  join(): string {
    return this.chunks.join('')
  }
}

/** Attaches a SIGKILL fallback timer that fires SIGKILL_GRACE_MS after SIGTERM. */
function armKillFallback(proc: ReturnType<typeof spawn>): void {
  const killTimer = setTimeout(() => {
    try { proc.kill('SIGKILL') } catch { /* ESRCH — process already exited */ }
  }, SIGKILL_GRACE_MS)
  proc.once('close', () => clearTimeout(killTimer))
}

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
  const output = new OutputCollector()

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, cmdArgs, {
      cwd,
      shell: false,
      env: { ...process.env, COREPACK_ENABLE_STRICT: '0', COREPACK_ENABLE_AUTO_PIN: '0' },
    })
    let done = false

    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      armKillFallback(proc)
      finish(() => reject(new Error(`빌드 타임아웃: ${timeoutMs}ms 초과`)))
    }, timeoutMs)

    proc.stdout.on('data', (chunk: Buffer) => { output.feed(chunk.toString(), onChunk) })
    proc.stderr.on('data', (chunk: Buffer) => { output.feed(chunk.toString(), onChunk) })

    proc.on('close', (code: number | null = 1) => {
      const exitCode = code ?? 1
      finish(() =>
        resolve({
          success: exitCode === 0,
          output: output.join(),
          exitCode,
          duration: Date.now() - startTime,
        })
      )
    })

    proc.on('error', (err: Error) => {
      finish(() => reject(err))
    })
  })
}
