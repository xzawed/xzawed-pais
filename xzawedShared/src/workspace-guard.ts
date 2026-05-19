import path from 'node:path'

export function validateWorkspaceRoot(workspaceRoot: string): void {
  const resolved = path.resolve(workspaceRoot)
  if (resolved === path.parse(resolved).root) {
    throw new Error('WORKSPACE_ROOT must not be filesystem root')
  }
}
