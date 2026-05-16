import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface ExecResult {
  success: boolean
  output: string
  exitCode: number
  duration: number
}

export async function validatePath(projectPath: string, workspaceRoot: string): Promise<string> {
  const realProject = await fs.realpath(projectPath).catch(() => path.resolve(projectPath))
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realProject)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${projectPath}`)
  }
  return realProject
}

export async function exec(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void | Promise<void>,
  timeoutMs: number
): Promise<ExecResult> {
  const startTime = Date.now()
  const chunks: string[] = []

  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], { cwd, shell: true })
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      settle(() => reject(new Error(`빌드 타임아웃: ${timeoutMs}ms 초과`)))
    }, timeoutMs)

    proc.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString()
      chunks.push(str)
      Promise.resolve(onChunk(str)).catch(() => {})
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString()
      chunks.push(str)
      Promise.resolve(onChunk(str)).catch(() => {})
    })

    proc.on('close', (code: number | null) => {
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
