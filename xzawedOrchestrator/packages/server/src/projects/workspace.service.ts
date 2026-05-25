import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export class WorkspaceService {
  readonly workspacesDir = process.env.WORKSPACES_DIR ?? join(homedir(), '.xzawed', 'workspaces')

  clonePath(projectId: string): string {
    return join(this.workspacesDir, projectId)
  }

  async validateLocalPath(localPath: string): Promise<void> {
    try {
      await access(localPath, constants.R_OK)
    } catch {
      throw new Error(`로컬 경로에 접근할 수 없습니다: ${localPath}`)
    }
  }

  async cloneRepo(repoUrl: string, destPath: string, branch: string): Promise<void> {
    await this.runGit(
      ['clone', '--branch', branch, '--depth', '1', '--', repoUrl, destPath],
      undefined,
    )
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
