import fs from 'node:fs/promises'
import type { UserContext } from './types/user-context.js'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

export { validateWorkspaceRoot }

export async function ensureWorkspace(userContext: UserContext): Promise<void> {
  validateWorkspaceRoot(userContext.workspaceRoot)
  await fs.mkdir(userContext.workspaceRoot, { recursive: true })
}
