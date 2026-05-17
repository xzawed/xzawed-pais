import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileChange } from './types.js'

export async function validatePath(filePath: string, workspaceRoot: string): Promise<string> {
  // Prevent WORKSPACE_ROOT from being filesystem root — would allow any absolute path to pass
  const resolvedRoot = path.resolve(workspaceRoot)
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error('WORKSPACE_ROOT must not be filesystem root')
  }

  const resolved = path.resolve(workspaceRoot, filePath)
  const realFile = await fs.realpath(resolved).catch(() => resolved)
  const realRoot = await fs.realpath(workspaceRoot).catch(() => resolvedRoot)
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
  await fs.writeFile(validated, change.content ?? '', 'utf-8')
}
