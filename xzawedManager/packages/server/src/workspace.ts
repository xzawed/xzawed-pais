import fs from 'node:fs/promises'
import path from 'node:path'
import type { UserContext } from './types/user-context.js'

function validateWorkspaceRoot(workspaceRoot: string): void {
  if (!workspaceRoot || workspaceRoot.trim() === '') {
    throw new Error('WORKSPACE_ROOT must not be empty')
  }
  const resolved = path.resolve(workspaceRoot)
  const rootPart = path.parse(resolved).root
  if (resolved === rootPart || resolved === rootPart.replace(/[\\/]$/, '')) {
    throw new Error('WORKSPACE_ROOT must not be filesystem root')
  }
}

export async function ensureWorkspace(userContext: UserContext): Promise<void> {
  validateWorkspaceRoot(userContext.workspaceRoot)
  await fs.mkdir(userContext.workspaceRoot, { recursive: true })
}
