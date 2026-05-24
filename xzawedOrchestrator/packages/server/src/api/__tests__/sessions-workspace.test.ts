import { describe, it, expect } from 'vitest'
import { resolveSessionWorkspaceRoot } from '../sessions.route.js'
import type { Project } from '../../projects/project.repo.js'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    userId: 'user-1',
    name: 'test',
    slug: 'test',
    description: null,
    githubOwner: null,
    githubRepo: null,
    githubBranch: 'main',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('resolveSessionWorkspaceRoot', () => {
  it('returns project.workspace_path when set', () => {
    const project = makeProject({ workspace_path: '/home/user/my-app' })
    expect(resolveSessionWorkspaceRoot(project, '/fallback')).toBe('/home/user/my-app')
  })

  it('falls back to envFallback when workspace_path is null', () => {
    const project = makeProject({ workspace_path: null })
    expect(resolveSessionWorkspaceRoot(project, '/fallback')).toBe('/fallback')
  })

  it('falls back to envFallback when workspace_path is undefined', () => {
    const project = makeProject({ workspace_path: undefined })
    expect(resolveSessionWorkspaceRoot(project, '/fallback')).toBe('/fallback')
  })

  it('falls back to envFallback when project is null (no project attached to session)', () => {
    expect(resolveSessionWorkspaceRoot(null, '/fallback')).toBe('/fallback')
  })

  it('falls back to envFallback when project is undefined', () => {
    expect(resolveSessionWorkspaceRoot(undefined, '/fallback')).toBe('/fallback')
  })
})
