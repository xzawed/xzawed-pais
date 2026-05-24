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
  if (await fs.access(path.join(dir, 'package.json')).then(() => true).catch(() => false)) {
    return 'pnpm run build'
  }
  if (await fs.access(path.join(dir, 'go.mod')).then(() => true).catch(() => false)) {
    return 'go build ./...'
  }
  return null
}

export async function detectBuildInfo(projectPath: string, workspaceRoot: string): Promise<BuildDetectionResult> {
  // Walk up from projectPath to workspaceRoot looking for build files.
  // Returns the detected command and the directory where the build file was found.
  // Handles the case where an agent writes files to a parent directory
  // while the build request targets a deeper subdirectory.
  // NOTE: workspaceRoot must be an absolute non-root path; caller is responsible for
  //       validating workspaceRoot with validateWorkspaceRoot() before calling here.
  if (!workspaceRoot) throw new Error('workspaceRoot는 필수입니다')
  let dir = path.resolve(projectPath)
  const root = path.resolve(workspaceRoot)

  // Ensure dir does not start outside workspaceRoot before walking
  const initial = path.relative(root, dir)
  if (initial.startsWith('..') || path.isAbsolute(initial)) {
    throw new Error(`경로 거부: ${projectPath} is outside workspaceRoot`)
  }

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

export async function detectBuildCommand(projectPath: string, workspaceRoot: string): Promise<string> {
  const { command } = await detectBuildInfo(projectPath, workspaceRoot)
  return command
}
