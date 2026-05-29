import fs from 'node:fs/promises'
import path from 'node:path'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'
import type { FileChange } from './types.js'

export async function validatePath(filePath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)

  const resolved = path.resolve(workspaceRoot, filePath)
  const realFile = await fs.realpath(resolved).catch(() => resolved)
  const realRoot = await fs.realpath(workspaceRoot).catch(() => workspaceRoot)
  const relative = path.relative(realRoot, realFile)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${filePath}`)
  }
  return realFile
}

/** maxAgeDays일 이상 된 .bak.{timestamp} 파일을 삭제한다. */
export async function cleanupOldBakFiles(directory: string, maxAgeDays = 7): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let removed = 0
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.bak\.\d+$/.test(entry.name)) continue
      const filePath = path.join(directory, entry.name)
      try {
        const stat = await fs.stat(filePath)
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filePath)
          removed++
        }
      } catch {
        // 이미 삭제됐거나 접근 불가: 무시
      }
    }
  } catch {
    // 디렉터리 읽기 실패: 무시
  }
  return removed
}

export async function applyChange(change: FileChange, workspaceRoot: string): Promise<void> {
  const validated = await validatePath(change.path, workspaceRoot)

  if (change.operation === 'delete') {
    const bakPath = `${validated}.bak.${Date.now()}`
    await fs.rename(validated, bakPath)
    // 오래된 .bak 파일 정리 (7일 기준, 비동기 - 실패 무시)
    void cleanupOldBakFiles(path.dirname(validated), 7)
    return
  }

  await fs.mkdir(path.dirname(validated), { recursive: true })
  // Atomic write: write to a temp file then rename to avoid partial writes on crash.
  const tmpPath = `${validated}.tmp.${Date.now()}`
  try {
    await fs.writeFile(tmpPath, change.content ?? '', 'utf-8')
    await fs.rename(tmpPath, validated)
  } catch (err) {
    // Best-effort cleanup of the temp file; ignore cleanup errors.
    await fs.unlink(tmpPath).catch(() => undefined)
    throw err
  }
}
