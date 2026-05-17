import { Octokit } from '@octokit/rest'
import type { ToolHandler } from './handler.interface.js'

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
      switch (input.action) {
        case 'createRepo': {
          const { data } = await octokit.rest.repos.createForAuthenticatedUser({
            name: input.repoName!,
            description: input.description,
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
            owner: input.owner!,
            repo: input.repo!,
            ref: `heads/${input.fromBranch ?? 'main'}`,
          })
          await octokit.rest.git.createRef({
            owner: input.owner!,
            repo: input.repo!,
            ref: `refs/heads/${input.branch!}`,
            sha: ref.object.sha,
          })
          return { branch: input.branch, sha: ref.object.sha }
        }

        case 'listBranches': {
          const { data } = await octokit.rest.repos.listBranches({ owner: input.owner!, repo: input.repo! })
          return data.map((b) => ({ name: b.name, sha: b.commit.sha }))
        }

        case 'commitAndPush': {
          const { files = [], commitMessage = 'chore: update files', branch, owner, repo } = input
          const blobs = await Promise.all(
            files.map((f) =>
              octokit.rest.git.createBlob({
                owner: owner!, repo: repo!,
                content: Buffer.from(f.content).toString('base64'),
                encoding: 'base64',
              })
            )
          )
          const { data: baseRef } = await octokit.rest.git.getRef({ owner: owner!, repo: repo!, ref: `heads/${branch!}` })
          const { data: baseCommit } = await octokit.rest.git.getCommit({ owner: owner!, repo: repo!, commit_sha: baseRef.object.sha })
          const { data: tree } = await octokit.rest.git.createTree({
            owner: owner!, repo: repo!,
            base_tree: baseCommit.tree.sha,
            tree: files.map((f, i) => ({ path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blobs[i].data.sha })),
          })
          const { data: commit } = await octokit.rest.git.createCommit({
            owner: owner!, repo: repo!,
            message: commitMessage,
            tree: tree.sha,
            parents: [baseRef.object.sha],
          })
          await octokit.rest.git.updateRef({ owner: owner!, repo: repo!, ref: `heads/${branch!}`, sha: commit.sha })
          return { sha: commit.sha, branch }
        }

        case 'createPR': {
          const { data } = await octokit.rest.pulls.create({
            owner: input.owner!, repo: input.repo!,
            title: input.title!, head: input.head!, base: input.base ?? 'main',
            body: input.body ?? '',
          })
          return { number: data.number, url: data.html_url, title: data.title }
        }

        case 'createIssue': {
          const { data } = await octokit.rest.issues.create({
            owner: input.owner!, repo: input.repo!,
            title: input.title!, body: input.body ?? '',
          })
          return { number: data.number, url: data.html_url, title: data.title }
        }

        case 'mergeBranch': {
          const { data } = await octokit.rest.repos.merge({
            owner: input.owner!, repo: input.repo!,
            base: input.base ?? 'main', head: input.head!,
          })
          return { sha: data?.sha, merged: true }
        }

        default:
          throw new Error(`Unknown github action: ${String(input.action)}`)
      }
    },
  }
}
