import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { internalRoutes } from '../internal.route.js'
import type { SessionStore } from '../../sessions/session.store.js'

const mockCreate = vi.fn()
const mockUpdateWorkspace = vi.fn()
const mockFindByIdAndUser = vi.fn()
const mockFindByUser = vi.fn()
const mockValidateLocalPath = vi.fn()
const mockClonePath = vi.fn()
const mockCloneRepo = vi.fn()

vi.mock('../../projects/project.repo.js', () => ({
  ProjectRepo: vi.fn().mockImplementation(() => ({
    create: mockCreate,
    updateWorkspace: mockUpdateWorkspace,
    findByIdAndUser: mockFindByIdAndUser,
    findByUser: mockFindByUser,
  })),
}))

vi.mock('../../projects/workspace.service.js', () => ({
  WorkspaceService: vi.fn().mockImplementation(() => ({
    validateLocalPath: mockValidateLocalPath,
    clonePath: mockClonePath,
    cloneRepo: mockCloneRepo,
  })),
}))

function makeStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(undefined),
    updateState: vi.fn().mockResolvedValue(undefined),
    updateClaudeSessionId: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const BASE_PROJECT = {
  id: 'proj-1',
  userId: 'user-1',
  name: 'test-app',
  slug: 'test-app',
  description: null,
  githubOwner: null,
  githubRepo: null,
  githubBranch: 'main',
  createdAt: new Date(),
  updatedAt: new Date(),
  workspace_type: undefined,
  local_path: null,
  repo_url: null,
  branch: 'main',
  workspace_path: null,
  push_strategy: 'push',
}

const BASE_SESSION = { id: 'sess-1', userId: 'user-1', projectId: null }

async function buildApp(store: SessionStore): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(internalRoutes, {
    pool: {} as never,
    store,
  })
  return app
}

describe('internalRoutes — POST /internal/sessions/:id/register-project', () => {
  let app: FastifyInstance
  let store: SessionStore

  beforeEach(async () => {
    mockCreate.mockReset()
    mockUpdateWorkspace.mockReset()
    mockFindByIdAndUser.mockReset()
    mockFindByUser.mockReset()
    mockValidateLocalPath.mockReset()
    mockClonePath.mockReset()
    mockCloneRepo.mockReset()

    store = makeStore({
      findById: vi.fn().mockResolvedValue(BASE_SESSION),
    })
    app = await buildApp(store)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when session is not found', async () => {
    store.findById = vi.fn().mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/unknown/register-project',
      payload: { name: 'app', workspaceType: 'local', localPath: '/home/user/app' },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' })
  })

  it('returns 400 when workspaceType is local but localPath is missing', async () => {
    mockCreate.mockResolvedValue(BASE_PROJECT)
    mockUpdateWorkspace.mockResolvedValue(BASE_PROJECT)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/register-project',
      payload: { name: 'app', workspaceType: 'local' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'localPath required' })
  })

  it('returns 200 with status=registered for local workspace type', async () => {
    mockCreate.mockResolvedValue(BASE_PROJECT)
    mockUpdateWorkspace.mockResolvedValue(BASE_PROJECT)
    mockValidateLocalPath.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/register-project',
      payload: { name: 'test-app', workspaceType: 'local', localPath: '/home/user/app' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { projectId: string; workspacePath: string; status: string }
    expect(body.projectId).toBe('proj-1')
    expect(body.workspacePath).toBe('/home/user/app')
    expect(body.status).toBe('registered')
  })

  it('returns 400 when workspaceType is github but repoUrl is missing', async () => {
    mockCreate.mockResolvedValue(BASE_PROJECT)
    mockUpdateWorkspace.mockResolvedValue(BASE_PROJECT)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/register-project',
      payload: { name: 'app', workspaceType: 'github' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'repoUrl required' })
  })

  it('returns 400 when repoUrl uses invalid protocol', async () => {
    mockCreate.mockResolvedValue(BASE_PROJECT)
    mockUpdateWorkspace.mockResolvedValue(BASE_PROJECT)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/register-project',
      payload: { name: 'app', workspaceType: 'github', repoUrl: 'ftp://github.com/user/repo' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'repoUrl must use https or http protocol' })
  })

  it('returns 200 with status=cloning for github workspace type', async () => {
    mockCreate.mockResolvedValue(BASE_PROJECT)
    mockUpdateWorkspace.mockResolvedValue(BASE_PROJECT)
    mockClonePath.mockReturnValue('/home/user/.xzawed/workspaces/proj-1')
    mockCloneRepo.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/register-project',
      payload: {
        name: 'test-app',
        workspaceType: 'github',
        repoUrl: 'https://github.com/user/repo',
        branch: 'main',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { projectId: string; workspacePath: string; status: string }
    expect(body.projectId).toBe('proj-1')
    expect(body.workspacePath).toBe('/home/user/.xzawed/workspaces/proj-1')
    expect(body.status).toBe('cloning')
  })
})

describe('internalRoutes — POST /internal/sessions/:id/switch-project', () => {
  let app: FastifyInstance
  let store: SessionStore

  beforeEach(async () => {
    mockCreate.mockReset()
    mockUpdateWorkspace.mockReset()
    mockFindByIdAndUser.mockReset()
    mockFindByUser.mockReset()
    mockValidateLocalPath.mockReset()
    mockClonePath.mockReset()
    mockCloneRepo.mockReset()

    store = makeStore({
      findById: vi.fn().mockResolvedValue(BASE_SESSION),
    })
    app = await buildApp(store)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when session is not found', async () => {
    store.findById = vi.fn().mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/unknown/switch-project',
      payload: { projectId: 'proj-1' },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Session not found' })
  })

  it('returns 404 when project is not found by projectId', async () => {
    mockFindByIdAndUser.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/switch-project',
      payload: { projectId: 'nonexistent-proj' },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' })
  })

  it('returns 200 when switching by projectId', async () => {
    const project = { ...BASE_PROJECT, workspace_path: '/home/user/app' }
    mockFindByIdAndUser.mockResolvedValue(project)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/switch-project',
      payload: { projectId: 'proj-1' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { projectId: string; name: string; workspacePath: string }
    expect(body.projectId).toBe('proj-1')
    expect(body.name).toBe('test-app')
    expect(body.workspacePath).toBe('/home/user/app')
  })

  it('returns 200 when switching by name', async () => {
    const project = { ...BASE_PROJECT, workspace_path: '/home/user/app' }
    mockFindByUser.mockResolvedValue([project])

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/switch-project',
      payload: { name: 'test-app' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { projectId: string; name: string; workspacePath: string }
    expect(body.projectId).toBe('proj-1')
    expect(body.name).toBe('test-app')
    expect(body.workspacePath).toBe('/home/user/app')
  })

  it('returns 404 when project not found by name', async () => {
    mockFindByUser.mockResolvedValue([])

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/switch-project',
      payload: { name: 'nonexistent-app' },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' })
  })

  it('returns 404 when neither projectId nor name provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/switch-project',
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' })
  })

  it('returns null workspacePath when project has no workspace_path', async () => {
    const project = { ...BASE_PROJECT, workspace_path: null }
    mockFindByIdAndUser.mockResolvedValue(project)

    const res = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sess-1/switch-project',
      payload: { projectId: 'proj-1' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { workspacePath: null }
    expect(body.workspacePath).toBeNull()
  })
})
