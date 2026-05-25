import fs from 'node:fs/promises'
import type { UserContext } from './types/user-context.js'

export async function ensureWorkspace(userContext: UserContext): Promise<void> {
  await fs.mkdir(userContext.workspaceRoot, { recursive: true })
}
