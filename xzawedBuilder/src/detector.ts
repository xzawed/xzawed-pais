import fs from 'node:fs/promises'
import path from 'node:path'

export interface BuildDetectionResult {
  command: string
  buildRoot: string
}

async function detectAt(dir: string): Promise<string | null> {
  if (await fs.access(path.join(dir, 'Cargo.toml')).then(() => true).catch(() => false)) {
    return 'cargo build --release'
  }
  if (await fs.access(path.join(dir, 'Makefile')).then(() => true).catch(() => false)) {
    return 'make build'
  }
  const pkgPath = path.join(dir, 'package.json')
  if (await fs.access(pkgPath).then(() => true).catch(() => false)) {
    try {
      const content = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(content) as {
        devDependencies?: Record<string, string>
        dependencies?: Record<string, string>
      }
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if ('vite' in allDeps) return 'pnpm run build'
      if ('webpack' in allDeps) return 'pnpm run build'
      if ('tsc' in allDeps || 'typescript' in allDeps) return 'pnpm run build'
      return 'pnpm run build'
    } catch {
      return 'pnpm run build'
    }
  }
  if (await fs.access(path.join(dir, 'go.mod')).then(() => true).catch(() => false)) {
    return 'go build ./...'
  }
  return null
}

export async function detectBuildInfo(projectPath: string, workspaceRoot = '/'): Promise<BuildDetectionResult> {
  // Walk up from projectPath to workspaceRoot looking for build files.
  // Returns the detected command and the directory where the build file was found.
  // Handles the case where an agent writes files to a parent directory
  // while the build request targets a deeper subdirectory.
  let dir = path.resolve(projectPath)
  const root = path.resolve(workspaceRoot)

  while (true) {
    const cmd = await detectAt(dir)
    if (cmd !== null) return { command: cmd, buildRoot: dir }

    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir) break  // filesystem root
    dir = parent
  }

  throw new Error('빌드 명령을 감지할 수 없음')
}

export async function detectBuildCommand(projectPath: string, workspaceRoot = '/'): Promise<string> {
  const { command } = await detectBuildInfo(projectPath, workspaceRoot)
  return command
}
