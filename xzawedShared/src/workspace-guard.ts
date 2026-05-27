import path from 'node:path'

export function resolveWorkspaceRoot(
  userContext: { workspaceRoot: string; [key: string]: unknown } | undefined,
  fallback: string | undefined,
): string {
  const resolved = userContext?.workspaceRoot || fallback || process.env['WORKSPACE_ROOT']
  if (!resolved) {
    throw new Error('workspaceRoot를 결정할 수 없습니다: userContext, fallback, WORKSPACE_ROOT 모두 미설정')
  }
  return resolved
}

export function validateWorkspaceRoot(workspaceRoot: string): void {
  if (!workspaceRoot || workspaceRoot.trim() === '') {
    throw new Error('WORKSPACE_ROOT must not be empty')
  }

  const resolved = path.resolve(workspaceRoot)
  const rootPart = path.parse(resolved).root

  if (resolved === rootPart || resolved === rootPart.replace(/[\\/]$/, '')) {
    throw new Error('WORKSPACE_ROOT must not be filesystem root')
  }
}
