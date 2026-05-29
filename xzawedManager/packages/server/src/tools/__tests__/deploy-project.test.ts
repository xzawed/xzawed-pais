import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Octokit 전체 mock
vi.mock('@octokit/rest', () => {
  const MockOctokit = vi.fn().mockImplementation(() => ({
    repos: { get: vi.fn(), createForAuthenticatedUser: vi.fn() },
    git: {
      createBlob: vi.fn(),
      createTree: vi.fn(),
      createCommit: vi.fn(),
      updateRef: vi.fn(),
      createRef: vi.fn(),
      getRef: vi.fn(),
    },
  }))
  return { Octokit: MockOctokit }
})

import { Octokit } from '@octokit/rest'
import { createDeployProjectHandler } from '../deploy-project.js'

const MockOctokit = vi.mocked(Octokit)

function getOctokitInstance() {
  return MockOctokit.mock.results[MockOctokit.mock.results.length - 1]!.value as ReturnType<typeof Octokit>
}

let tmpDir: string

beforeEach(async () => {
  vi.clearAllMocks()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('deploy_project 도구', () => {
  it('도구 이름이 deploy_project이다', () => {
    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    expect(handler.name).toBe('deploy_project')
  })

  it('description에 GitHub이 포함된다', () => {
    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    expect(handler.description).toContain('GitHub')
  })

  it('inputSchema에 필수 필드가 있다', () => {
    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    const required = (handler.inputSchema as { required: string[] }).required
    expect(required).toContain('projectPath')
    expect(required).toContain('owner')
    expect(required).toContain('repo')
    expect(required).toContain('branch')
    expect(required).toContain('commitMessage')
  })

  it('execute() 시 collectFiles가 파일을 수집하고 createBlob을 파일 수만큼 호출한다', async () => {
    await fs.writeFile(path.join(tmpDir, 'index.ts'), 'console.log("hello")')
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test')

    MockOctokit.mockImplementationOnce(() => ({
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
        createForAuthenticatedUser: vi.fn(),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'abc123' } } }),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: 'blob-sha' } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } }),
        updateRef: vi.fn().mockResolvedValue({}),
        createRef: vi.fn(),
      },
    }))

    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    await handler.execute(
      { projectPath: tmpDir, owner: 'owner', repo: 'repo', branch: 'main', commitMessage: 'test' },
      'session-1',
    )

    const octokit = getOctokitInstance()
    expect(octokit.git.createBlob).toHaveBeenCalledTimes(2)
  })

  it('저장소가 없고 createRepo:true일 때 createForAuthenticatedUser를 호출한다', async () => {
    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'export {}')

    MockOctokit.mockImplementationOnce(() => ({
      repos: {
        get: vi.fn()
          .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
          .mockResolvedValue({ data: { default_branch: 'main' } }),
        createForAuthenticatedUser: vi.fn().mockResolvedValue({
          data: { html_url: 'https://github.com/owner/new-repo' },
        }),
      },
      git: {
        getRef: vi.fn()
          .mockRejectedValueOnce(new Error('not found'))
          .mockResolvedValue({ data: { object: { sha: 'parent-sha' } } }),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: 'blob-sha' } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } }),
        updateRef: vi.fn().mockResolvedValue({}),
        createRef: vi.fn(),
      },
    }))

    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    await handler.execute(
      { projectPath: tmpDir, owner: 'owner', repo: 'new-repo', branch: 'main', commitMessage: 'init', createRepo: true },
      'session-2',
    )

    const octokit = getOctokitInstance()
    expect(octokit.repos.createForAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new-repo' }),
    )
  })

  it('성공 시 반환값에 content, repoUrl, commitSha가 있다', async () => {
    await fs.writeFile(path.join(tmpDir, 'main.ts'), 'export const x = 1')

    MockOctokit.mockImplementationOnce(() => ({
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
        createForAuthenticatedUser: vi.fn(),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'parent-sha' } } }),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: 'blob-sha' } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'final-commit-sha' } }),
        updateRef: vi.fn().mockResolvedValue({}),
        createRef: vi.fn(),
      },
    }))

    const handler = createDeployProjectHandler('gh-token', 'redis://localhost')
    const result = await handler.execute(
      { projectPath: tmpDir, owner: 'myuser', repo: 'myrepo', branch: 'main', commitMessage: 'deploy' },
      'session-3',
    )

    expect(result.content).toBeDefined()
    expect(typeof result.content).toBe('string')
    expect(result.repoUrl).toContain('github.com')
    expect(result.commitSha).toBe('final-commit-sha')
  })

  it('파일이 없는 디렉터리에서 execute() 시 에러를 던진다', async () => {
    MockOctokit.mockImplementationOnce(() => ({
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }), createForAuthenticatedUser: vi.fn() },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'parent-sha' } } }),
        createBlob: vi.fn(), createTree: vi.fn(), createCommit: vi.fn(), updateRef: vi.fn(), createRef: vi.fn(),
      },
    }))

    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    await expect(
      handler.execute(
        { projectPath: tmpDir, owner: 'owner', repo: 'repo', branch: 'main', commitMessage: 'empty' },
        'session-4',
      ),
    ).rejects.toThrow('배포할 파일이 없습니다')
  })

  it('저장소가 없고 createRepo:false이면 에러를 다시 던진다', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'export {}')

    MockOctokit.mockImplementationOnce(() => ({
      repos: {
        get: vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 })),
        createForAuthenticatedUser: vi.fn(),
      },
      git: { getRef: vi.fn(), createBlob: vi.fn(), createTree: vi.fn(), createCommit: vi.fn(), updateRef: vi.fn(), createRef: vi.fn() },
    }))

    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    await expect(
      handler.execute(
        { projectPath: tmpDir, owner: 'owner', repo: 'missing-repo', branch: 'main', commitMessage: 'x' },
        'session-5',
      ),
    ).rejects.toThrow()
  })

  it('updateRef 실패 시 createRef를 호출한다', async () => {
    await fs.writeFile(path.join(tmpDir, 'src.ts'), 'const a = 1')

    MockOctokit.mockImplementationOnce(() => ({
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }), createForAuthenticatedUser: vi.fn() },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'parent-sha' } } }),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: 'blob-sha' } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } }),
        updateRef: vi.fn().mockRejectedValue(new Error('ref does not exist')),
        createRef: vi.fn().mockResolvedValue({}),
      },
    }))

    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    await handler.execute(
      { projectPath: tmpDir, owner: 'owner', repo: 'repo', branch: 'new-branch', commitMessage: 'init' },
      'session-6',
    )

    const octokit = getOctokitInstance()
    expect(octokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/new-branch' }),
    )
  })
})
