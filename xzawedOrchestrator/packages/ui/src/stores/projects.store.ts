import { create } from 'zustand'

export interface Project {
  id: string
  name: string
  slug: string
  description?: string | undefined
  githubOwner?: string | undefined
  githubRepo?: string | undefined
  githubBranch?: string | undefined
  createdAt: string
  workspace_type?: 'none' | 'local' | 'github'
  local_path?: string | null
  repo_url?: string | null
  branch?: string
  workspace_path?: string | null
  push_strategy?: 'push' | 'pr'
}

interface ProjectsState {
  projects: Project[]
  currentProjectId: string | null
  isLoading: boolean
  fetchProjects: (serverUrl: string, accessToken: string) => Promise<void>
  createProject: (
    serverUrl: string,
    accessToken: string,
    data: { name: string; slug: string; description?: string }
  ) => Promise<Project>
  setCurrentProject: (id: string | null) => void
  updateWorkspace: (
    serverUrl: string,
    token: string,
    projectId: string,
    workspace: {
      workspaceType: 'none' | 'local' | 'github'
      localPath?: string
      repoUrl?: string
      branch?: string
      pushStrategy?: 'push' | 'pr'
    },
  ) => Promise<void>
  syncWorkspace: (serverUrl: string, token: string, projectId: string) => Promise<void>
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,

  fetchProjects: async (serverUrl, accessToken) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`${serverUrl}/projects`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) throw new Error('Failed to fetch projects')
      const projects = (await res.json()) as Project[]
      set({ projects, isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  createProject: async (serverUrl, accessToken, data) => {
    const res = await fetch(`${serverUrl}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to create project')
    const project = (await res.json()) as Project
    set({ projects: [...get().projects, project] })
    return project
  },

  setCurrentProject: (id) => set({ currentProjectId: id }),

  updateWorkspace: async (serverUrl, token, projectId, workspace) => {
    const res = await fetch(`${serverUrl}/projects/${projectId}/workspace`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(workspace),
    })
    if (!res.ok) throw new Error(`workspace 업데이트 실패: ${res.status}`)
    const updated = await res.json() as Project
    set((s) => ({
      projects: s.projects.map((p) => p.id === projectId ? { ...p, ...updated } : p),
    }))
  },

  syncWorkspace: async (serverUrl, token, projectId) => {
    const res = await fetch(`${serverUrl}/projects/${projectId}/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`동기화 실패: ${res.status}`)
  },
}))
