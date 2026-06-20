import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler } from './handler.interface.js'
import type { UserContext } from '../types/user-context.js'
import type { DeployGatePort } from './deploy-gate.js'

interface DeployProjectInput {
  projectPath: string
  owner: string
  repo: string
  branch: string
  commitMessage: string
  createRepo?: boolean
  makePrivate?: boolean
}

interface DeployProjectOutput {
  content: string
  repoUrl: string
  commitSha?: string
}

const DEPLOY_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.env', '.env.local',
  'coverage', '.nyc_output', '__pycache__',
])

async function collectFiles(dir: string, root: string): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (DEPLOY_IGNORE.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        results.push(...await collectFiles(fullPath, root))
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          results.push({ path: relativePath, content })
        } catch {
          // 바이너리 파일 스킵
        }
      }
    }
  } catch {
    // 디렉터리 읽기 실패 무시
  }
  return results
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    projectPath:   { type: 'string', description: '배포할 프로젝트 디렉터리 경로' },
    owner:         { type: 'string', description: 'GitHub 사용자명 또는 조직명' },
    repo:          { type: 'string', description: 'GitHub 저장소 이름' },
    branch:        { type: 'string', description: '대상 브랜치' },
    commitMessage: { type: 'string', description: '커밋 메시지' },
    createRepo:    { type: 'boolean', description: '저장소가 없으면 자동 생성' },
    makePrivate:   { type: 'boolean', description: '저장소 생성 시 private 여부' },
  },
  required: ['projectPath', 'owner', 'repo', 'branch', 'commitMessage'],
}

const _outputSchema = z.object({
  content:   z.string().default(''),
  repoUrl:   z.string().default(''),
  commitSha: z.string().optional(),
})

class DeployProjectHandler implements ToolHandler<DeployProjectInput, DeployProjectOutput> {
  name = 'deploy_project'
  description = 'GitHub 저장소에 프로젝트 파일을 배포한다. 저장소가 없으면 자동 생성하고 파일을 커밋하여 push한다.'
  inputSchema = inputSchema

  constructor(
    private readonly githubToken: string,
    private readonly _redisUrl: string,
    private readonly gate?: DeployGatePort,
  ) {}

  async execute(
    input: DeployProjectInput,
    _sessionId: string,
    userContext?: UserContext,
  ): Promise<DeployProjectOutput> {
    if (this.gate) {
      const verdict = await this.gate.checkDeploy(userContext?.projectId)
      if (!verdict.allowed) {
        throw new Error(`deploy_project 차단: ${verdict.reason}`)
      }
    }
    const octokit = new Octokit({ auth: this.githubToken })
    const { projectPath, owner, repo, branch, commitMessage, createRepo, makePrivate } = input

    let repoUrl = `https://github.com/${owner}/${repo}`

    // 저장소 존재 확인
    try {
      await octokit.repos.get({ owner, repo })
    } catch (e: unknown) {
      const status = (e as { status?: number }).status
      if (status === 404 && createRepo) {
        const created = await octokit.repos.createForAuthenticatedUser({
          name: repo,
          private: makePrivate ?? false,
          auto_init: true,
        })
        repoUrl = created.data.html_url
        // auto_init 완료 폴링: default branch ref가 준비될 때까지 지수 백오프
        const defaultBranch = created.data.default_branch ?? 'main'
        for (let i = 0; i < 6; i++) {
          await new Promise<void>(r => setTimeout(r, 500 * (i + 1)))
          try {
            await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` })
            break
          } catch {
            // 아직 준비 안 됨, 계속 폴링
          }
        }
      } else {
        throw e
      }
    }

    // 파일 수집
    const files = await collectFiles(projectPath, projectPath)
    if (files.length === 0) throw new Error(`배포할 파일이 없습니다: ${projectPath}`)

    // 현재 브랜치 HEAD SHA 조회
    let parentSha: string
    try {
      const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
      parentSha = ref.data.object.sha
    } catch {
      const repoInfo = await octokit.repos.get({ owner, repo })
      const defaultRef = await octokit.git.getRef({
        owner, repo, ref: `heads/${repoInfo.data.default_branch}`,
      })
      parentSha = defaultRef.data.object.sha
    }

    // Blob 생성
    const blobs = await Promise.all(
      files.map(async f => {
        const { data } = await octokit.git.createBlob({
          owner, repo,
          content: Buffer.from(f.content).toString('base64'),
          encoding: 'base64',
        })
        return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: data.sha }
      })
    )

    // Tree 생성
    const { data: treeData } = await octokit.git.createTree({
      owner, repo, tree: blobs, base_tree: parentSha,
    })

    // Commit 생성
    const { data: commitData } = await octokit.git.createCommit({
      owner, repo, message: commitMessage,
      tree: treeData.sha, parents: [parentSha],
    })

    // Ref 업데이트
    try {
      await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commitData.sha })
    } catch {
      await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commitData.sha })
    }

    return {
      content: `${files.length}개 파일을 ${owner}/${repo}:${branch}에 배포 완료`,
      repoUrl,
      commitSha: commitData.sha,
    }
  }
}

export function createDeployProjectHandler(
  githubToken: string,
  redisUrl: string,
  gate?: DeployGatePort,
): ToolHandler<DeployProjectInput, DeployProjectOutput> {
  return new DeployProjectHandler(githubToken, redisUrl, gate)
}
