import { Octokit } from '@octokit/rest'
import type { ToolHandler } from './handler.interface.js'

function validateCommitPath(p: string): void {
  if (typeof p !== 'string' || p.length === 0) throw new Error('Invalid file path')
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new Error(`Absolute paths not allowed: ${p}`)
  if (p.includes('..')) throw new Error(`Path traversal rejected: ${p}`)
  if (/[\x00-\x1f]/.test(p)) throw new Error(`Invalid characters in path: ${p}`)
  if (p.toLowerCase().startsWith('.github/workflows/')) {
    throw new Error(`Writing to .github/workflows/ is not permitted: ${p}`)
  }
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['createRepo', 'createBranch', 'commitAndPush', 'createPR', 'createIssue', 'mergeBranch', 'listRepos', 'listBranches'],
      description: 'GitHub operation to perform',
    },
    owner:         { type: 'string' },
    repo:          { type: 'string' },
    repoName:      { type: 'string' },
    description:   { type: 'string' },
    private:       { type: 'boolean' },
    branch:        { type: 'string' },
    fromBranch:    { type: 'string' },
    base:          { type: 'string' },
    head:          { type: 'string' },
    title:         { type: 'string' },
    body:          { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
    commitMessage: { type: 'string' },
    issueNumber:   { type: 'number' },
  },
  required: ['action'],
}

type GithubInput = {
  action: 'createRepo' | 'createBranch' | 'commitAndPush' | 'createPR' | 'createIssue' | 'mergeBranch' | 'listRepos' | 'listBranches'
  owner?: string
  repo?: string
  repoName?: string
  description?: string
  private?: boolean
  branch?: string
  fromBranch?: string
  base?: string
  head?: string
  title?: string
  body?: string
  files?: Array<{ path: string; content: string }>
  commitMessage?: string
  issueNumber?: number
}

export function createGithubOpsHandler(token: string): ToolHandler<GithubInput, unknown> {
  const octokit = new Octokit({ auth: token })

  return {
    name: 'github_ops',
    description: 'Perform GitHub operations: create repo/branch, commit code, open PR, create issues',
    inputSchema,
    execute: async (input: GithubInput, _sessionId: string) => {
      function need<T>(val: T | undefined, name: string): T {
        if (val === undefined || val === null) {
          throw new Error(`github_ops [${input.action}] missing required field: ${name}`)
        }
        return val
      }

      switch (input.action) {
        case 'createRepo': {
          const { data } = await octokit.rest.repos.createForAuthenticatedUser({
            name: need(input.repoName, 'repoName'),
            ...(input.description !== undefined ? { description: input.description } : {}),
            private: input.private ?? false,
            auto_init: true,
          })
          return { id: data.id, name: data.name, fullName: data.full_name, defaultBranch: data.default_branch }
        }

        case 'listRepos': {
          const { data } = await octokit.rest.repos.listForAuthenticatedUser({ per_page: 100, sort: 'updated' })
          return data.map((r) => ({ id: r.id, name: r.name, fullName: r.full_name, private: r.private }))
        }

        case 'createBranch': {
          const { data: ref } = await octokit.rest.git.getRef({
            owner: need(input.owner, 'owner'),
            repo: need(input.repo, 'repo'),
            ref: `heads/${input.fromBranch ?? 'main'}`,
          })
          await octokit.rest.git.createRef({
            owner: need(input.owner, 'owner'),
            repo: need(input.repo, 'repo'),
            ref: `refs/heads/${need(input.branch, 'branch')}`,
            sha: ref.object.sha,
          })
          return { branch: input.branch, sha: ref.object.sha }
        }

        case 'listBranches': {
          const { data } = await octokit.rest.repos.listBranches({ owner: need(input.owner, 'owner'), repo: need(input.repo, 'repo') })
          return data.map((b) => ({ name: b.name, sha: b.commit.sha }))
        }

        case 'commitAndPush': {
          const { files = [], commitMessage = 'chore: update files' } = input
          const owner = need(input.owner, 'owner')
          const repo = need(input.repo, 'repo')
          const branch = need(input.branch, 'branch')
          if (!Array.isArray(files)) throw new Error('github_ops [commitAndPush] files must be an array')
          if (files.length === 0) throw new Error('github_ops [commitAndPush] files array must not be empty')
          files.forEach((f) => validateCommitPath(f.path))
          const blobs = await Promise.all(
            files.map((f) =>
              octokit.rest.git.createBlob({
                owner, repo,
                content: Buffer.from(f.content).toString('base64'),
                encoding: 'base64',
              })
            )
          )
          const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })
          const { data: baseCommit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseRef.object.sha })
          const { data: tree } = await octokit.rest.git.createTree({
            owner, repo,
            base_tree: baseCommit.tree.sha,
            tree: files.map((f, i) => {
              const blobSha = blobs[i]?.data.sha
              if (blobSha === undefined) throw new Error(`Failed to create blob for: ${f.path}`)
              return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blobSha }
            }),
          })
          const { data: commit } = await octokit.rest.git.createCommit({
            owner, repo,
            message: commitMessage,
            tree: tree.sha,
            parents: [baseRef.object.sha],
          })
          await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha })
          return { sha: commit.sha, branch }
        }

        case 'createPR': {
          const { data } = await octokit.rest.pulls.create({
            owner: need(input.owner, 'owner'), repo: need(input.repo, 'repo'),
            title: need(input.title, 'title'), head: need(input.head, 'head'), base: input.base ?? 'main',
            body: input.body ?? '',
          })
          return { number: data.number, url: data.html_url, title: data.title }
        }

        case 'createIssue': {
          const { data } = await octokit.rest.issues.create({
            owner: need(input.owner, 'owner'), repo: need(input.repo, 'repo'),
            title: need(input.title, 'title'), body: input.body ?? '',
          })
          return { number: data.number, url: data.html_url, title: data.title }
        }

        case 'mergeBranch': {
          const { data } = await octokit.rest.repos.merge({
            owner: need(input.owner, 'owner'), repo: need(input.repo, 'repo'),
            base: input.base ?? 'main', head: need(input.head, 'head'),
          })
          return { sha: data?.sha, merged: data?.sha !== undefined }
        }

        default:
          throw new Error(`Unknown github action: ${String(input.action)}`)
      }
    },
  }
}
