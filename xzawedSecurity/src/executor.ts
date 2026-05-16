import fs from 'node:fs/promises'
import path from 'node:path'

export async function validatePath(targetPath: string, workspaceRoot: string): Promise<string> {
  const realTarget = await fs.realpath(targetPath).catch(() => path.resolve(targetPath))
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${targetPath}`)
  }
  return realTarget
}
