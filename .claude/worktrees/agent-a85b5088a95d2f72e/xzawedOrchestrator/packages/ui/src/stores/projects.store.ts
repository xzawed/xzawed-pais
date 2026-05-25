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
}))
