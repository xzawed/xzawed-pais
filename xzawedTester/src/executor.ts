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

/**
 * LLM·Manager 가 보낸 경로를 **`workspaceRoot` 기준으로 앵커**한다.
 *
 * 계약(루트 CLAUDE.md)은 "LLM 생성 경로는 절대경로 금지, `workspaceRoot` 기준 상대경로"인데,
 * 예전에는 원시 인자를 그대로 `realpath` 해 **서버 프로세스의 cwd** 기준으로 풀었다.
 * xzawedSecurity 는 처음부터 workspaceRoot 기준이었고 그쪽이 계약과 맞다.
 *
 * **절대경로는 손대지 않는다.** `path.resolve(root, abs)` 를 쓰면 win32 가 POSIX 절대경로를
 * 드라이브 상대로 재해석해 로컬(Windows)과 CI·컨테이너(Linux)가 서로 다른 것을 검증하게 된다.
 * `isAbsolute` 분기는 양쪽에서 같다. `tester.ts` 는 `testFiles` 를 이미 절대경로로 넘긴다.
 *
 * **봉쇄는 이 함수가 하지 않는다** — 호출자의 `realpath` + `relative` 검사가 한다.
 */
function anchor(p: string, workspaceRoot: string): string {
  return path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p)
}

export async function validatePath(targetPath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)
  const realTarget = await fs.realpath(anchor(targetPath, workspaceRoot)).catch(() => {
    throw new Error(`경로 거부: ${targetPath} — 경로가 존재하지 않습니다`)
  })
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${targetPath}`)
  }
  return realTarget
}

const OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024 // 10 MB

export async function exec(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void | Promise<void>,
  timeoutMs: number
): Promise<ExecResult> {
  const startTime = Date.now()
  const chunks: string[] = []
  let totalBytes = 0
  let truncated = false

  return new Promise((resolve, reject) => {
    const parts = command.trim().split(/\s+/)
    const bin = parts[0]
    if (!bin) throw new Error(`Invalid command: ${command}`)
    const cmdArgs = parts.slice(1)
    const proc = spawn(bin, cmdArgs, {
      cwd,
      shell: false,
      env: { ...process.env, COREPACK_ENABLE_STRICT: '0', COREPACK_ENABLE_AUTO_PIN: '0' },
    })
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | null = null

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, 5000)
      settle(() => reject(new Error(`테스트 타임아웃: ${timeoutMs}ms 초과`)))
    }, timeoutMs)

    const handleChunk = (chunk: Buffer) => {
      const str = chunk.toString()
      if (totalBytes < OUTPUT_LIMIT_BYTES) {
        chunks.push(str)
        totalBytes += Buffer.byteLength(str)
        if (totalBytes >= OUTPUT_LIMIT_BYTES && !truncated) {
          truncated = true
          chunks.push('\n[출력 잘림: 10MB 한도 초과]\n')
        }
      }
      // Always drain the stream (even when truncated) to prevent backpressure
      Promise.resolve(onChunk(str)).catch(() => {})
    }

    proc.stdout.on('data', handleChunk)
    proc.stderr.on('data', handleChunk)

    proc.on('close', (code: number | null) => {
      if (killTimer !== null) {
        clearTimeout(killTimer)
        killTimer = null
      }
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
