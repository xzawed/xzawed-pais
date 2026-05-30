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
        json: async () => ({ projects: [mockProject] }),
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
        json: async () => ({ project: mockProject }),
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

  describe('updateWorkspace', () => {
    it('PATCH /projects/:id/workspace 를 호출하고 스토어를 업데이트한다', async () => {
      const { useProjectsStore } = await import('../stores/projects.store.js')
      useProjectsStore.setState({
        projects: [{ id: 'p1', name: 'my-app', slug: 'my-app', createdAt: '2026-01-01T00:00:00Z' }],
      })

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          project: {
            id: 'p1', name: 'my-app', slug: 'my-app', createdAt: '2026-01-01T00:00:00Z',
            workspace_type: 'local', workspace_path: '/home/user/app',
          },
        }),
      }))

      await useProjectsStore.getState().updateWorkspace('http://localhost:3000', 'token', 'p1', {
        workspaceType: 'local',
        localPath: '/home/user/app',
      })

      const fetchMock = vi.mocked(fetch)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:3000/projects/p1/workspace')
      expect(opts.method).toBe('PATCH')

      const updated = useProjectsStore.getState().projects.find((p) => p.id === 'p1')
      expect(updated?.workspace_type).toBe('local')
      expect(updated?.workspace_path).toBe('/home/user/app')

      vi.unstubAllGlobals()
    })

    it('응답이 실패하면 오류를 던진다', async () => {
      const { useProjectsStore } = await import('../stores/projects.store.js')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))

      await expect(
        useProjectsStore.getState().updateWorkspace('http://localhost:3000', 'token', 'p1', {
          workspaceType: 'none',
        }),
      ).rejects.toThrow('workspace 업데이트 실패: 400')

      vi.unstubAllGlobals()
    })
  })

  describe('syncWorkspace', () => {
    it('POST /projects/:id/sync 를 호출한다', async () => {
      const { useProjectsStore } = await import('../stores/projects.store.js')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      await useProjectsStore.getState().syncWorkspace('http://localhost:3000', 'token', 'p1')

      const fetchMock = vi.mocked(fetch)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://localhost:3000/projects/p1/sync')
      expect(opts.method).toBe('POST')

      vi.unstubAllGlobals()
    })

    it('응답이 실패하면 오류를 던진다', async () => {
      const { useProjectsStore } = await import('../stores/projects.store.js')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))

      await expect(
        useProjectsStore.getState().syncWorkspace('http://localhost:3000', 'token', 'p1'),
      ).rejects.toThrow('동기화 실패: 503')

      vi.unstubAllGlobals()
    })
  })
})
