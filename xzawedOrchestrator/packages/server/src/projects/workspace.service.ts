import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { validateBranchName } from './branch-validation.js'

export { validateBranchName } from './branch-validation.js'

/**
 * 경로 **검증**은 여기 없다 — `workspace-path.ts` 가 단일 출처다.
 *
 * 이 클래스에 두면 라우트 테스트 3개가 클래스를 통째로 mock 하므로 검증기가 그
 * 테스트들에서 전부 무력화된다. 라우트가 순수 모듈을 직접 import 해야 실제로 돈다.
 * 여기 남는 것은 clone·pull 같은 I/O 뿐이다.
 */
export class WorkspaceService {
  readonly workspacesDir = process.env.WORKSPACES_DIR ?? join(homedir(), '.xzawed', 'workspaces')

  clonePath(projectId: string): string {
    return join(this.workspacesDir, projectId)
  }

  async cloneRepo(repoUrl: string, destPath: string, branch: string): Promise<void> {
    validateBranchName(branch)
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
    validateBranchName(branch)
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
