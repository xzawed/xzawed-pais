import { spawn } from 'node:child_process'
import { access, constants, rm } from 'node:fs/promises'
import { join, resolve, parse } from 'node:path'
import { homedir } from 'node:os'

function assertNotFilesystemRoot(p: string): void {
  const resolved = resolve(p)
  const { root } = parse(resolved)
  // Reject the path if it IS the filesystem root (e.g. / or C:\)
  if (resolved === root || resolved === root.replace(/[\\/]$/, '')) {
    throw new Error('파일시스템 루트는 워크스페이스로 사용할 수 없습니다')
  }
}

export class WorkspaceService {
  readonly workspacesDir = process.env.WORKSPACES_DIR ?? join(homedir(), '.xzawed', 'workspaces')

  clonePath(projectId: string): string {
    return join(this.workspacesDir, projectId)
  }

  async validateLocalPath(localPath: string): Promise<void> {
    // Reject filesystem root paths before any I/O
    assertNotFilesystemRoot(localPath)
    try {
      await access(localPath, constants.R_OK)
    } catch {
      throw new Error(`로컬 경로에 접근할 수 없습니다: ${localPath}`)
    }
  }

  async cloneRepo(repoUrl: string, destPath: string, branch: string): Promise<void> {
    try {
      await this.runGit(
        ['clone', '--branch', branch, '--depth', '1', '--', repoUrl, destPath],
        undefined,
      )
    } catch (err) {
      // 실패 시 부분적으로 생성된 디렉토리 정리 — 재시도 시 "이미 존재하는 디렉토리" 에러 방지
      await rm(destPath, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  async pullRepo(workspacePath: string, branch: string): Promise<void> {
    await this.runGit(['fetch', 'origin', branch], workspacePath)
    await this.runGit(['reset', '--hard', `origin/${branch}`], workspacePath)
  }

  private runGit(args: string[], cwd: string | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('git', args, { // NOSONAR
        cwd,
        shell: false,
        stdio: 'pipe',
      })
      const stderr: string[] = []
      proc.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()))
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`git ${args[0]} failed (exit ${code}): ${stderr.join('')}`))
      })
      proc.on('error', reject)
    })
  }
}
