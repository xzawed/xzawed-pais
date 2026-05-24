import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockProject = {
  id: 'p1',
  name: 'Test Project',
  slug: 'test-project',
  createdAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useProjectsStore', () => {
  describe('fetchProjects', () => {
    it('프로젝트 목록을 가져와 상태에 저장한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [mockProject],
      }))

      const { useProjectsStore } = await import('../stores/projects.store.js')
      useProjectsStore.setState({ projects: [], isLoading: false })

      await useProjectsStore.getState().fetchProjects('http://localhost', 'at_test')

      expect(useProjectsStore.getState().projects).toEqual([mockProject])
      expect(useProjectsStore.getState().isLoading).toBe(false)

      vi.unstubAllGlobals()
    })

    it('실패 시 오류를 던지고 isLoading을 false로 복원한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }))

      const { useProjectsStore } = await import('../stores/projects.store.js')
      useProjectsStore.setState({ projects: [], isLoading: false })

      await expect(
        useProjectsStore.getState().fetchProjects('http://localhost', 'at_test'),
      ).rejects.toThrow('Failed to fetch projects')
      expect(useProjectsStore.getState().isLoading).toBe(false)

      vi.unstubAllGlobals()
    })
  })

  describe('createProject', () => {
    it('새 프로젝트를 생성하고 목록에 추가한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockProject,
      }))

      const { useProjectsStore } = await import('../stores/projects.store.js')
      useProjectsStore.setState({ projects: [], isLoading: false })

      const project = await useProjectsStore.getState().createProject(
        'http://localhost', 'at_test',
        { name: 'Test Project', slug: 'test-project' },
      )

      expect(project).toEqual(mockProject)
      expect(useProjectsStore.getState().projects).toContainEqual(mockProject)

      vi.unstubAllGlobals()
    })

    it('실패 시 오류를 던진다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }))

      const { useProjectsStore } = await import('../stores/projects.store.js')

      await expect(
        useProjectsStore.getState().createProject('http://localhost', 'at_test', { name: 'X', slug: 'x' }),
      ).rejects.toThrow('Failed to create project')

      vi.unstubAllGlobals()
    })
  })

  describe('setCurrentProject', () => {
    it('currentProjectId를 설정한다', async () => {
      const { useProjectsStore } = await import('../stores/projects.store.js')
      useProjectsStore.setState({ currentProjectId: null })

      useProjectsStore.getState().setCurrentProject('p1')
      expect(useProjectsStore.getState().currentProjectId).toBe('p1')
    })

    it('null로 설정하면 선택을 해제한다', async () => {
      const { useProjectsStore } = await import('../stores/projects.store.js')
      useProjectsStore.setState({ currentProjectId: 'p1' })

      useProjectsStore.getState().setCurrentProject(null)
      expect(useProjectsStore.getState().currentProjectId).toBeNull()
    })
  })
})
