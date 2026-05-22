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

export async function applyChange(change: FileChange, workspaceRoot: string): Promise<void> {
  const validated = await validatePath(change.path, workspaceRoot)

  if (change.operation === 'delete') {
    const bakPath = `${validated}.bak.${Date.now()}`
    await fs.rename(validated, bakPath)
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
