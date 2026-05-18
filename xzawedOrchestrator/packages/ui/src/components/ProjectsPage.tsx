import React, { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth.store.js'
import { useProjectsStore } from '../stores/projects.store.js'

interface Props {
  serverUrl: string
  onSelectProject: (projectId: string) => void
  onLogout: () => void
}

export function ProjectsPage({ serverUrl, onSelectProject, onLogout }: Readonly<Props>): React.JSX.Element {
  const { user, accessToken, logout } = useAuthStore()
  const { projects, isLoading, fetchProjects, createProject } = useProjectsStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (accessToken) {
      void fetchProjects(serverUrl, accessToken).catch((e: unknown) => console.error('[ProjectsPage] fetch:', e))
    }
  }, [serverUrl, accessToken, fetchProjects])

  const handleLogout = async (): Promise<void> => {
    await logout()
    onLogout()
  }

  const handleCreate = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault()
    setCreateError(null)
    try {
      const project = await createProject(serverUrl, accessToken!, { name: newName, slug: newSlug })
      setShowCreate(false)
      setNewName('')
      setNewSlug('')
      onSelectProject(project.id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project')
    }
  }

  return (
    <div className="min-h-screen overflow-auto bg-bg p-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-fg">Projects</h1>
            <p className="text-sm text-fg-muted">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Sign out
          </button>
        </div>

        {isLoading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject(project.id)}
                className="w-full rounded-xl border border-border bg-surface p-4 text-left hover:border-accent"
              >
                <p className="font-medium text-fg">{project.name}</p>
                {project.description !== undefined && project.description !== '' && (
                  <p className="mt-0.5 text-sm text-fg-muted">{project.description}</p>
                )}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="w-full rounded-xl border border-dashed border-border p-4 text-sm text-fg-muted hover:border-accent hover:text-fg"
            >
              + New project
            </button>
          </div>
        )}

        {showCreate && (
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="mt-6 space-y-4 rounded-xl border border-border bg-surface p-6"
          >
            {createError !== null && (
              <p className="text-sm text-danger">{createError}</p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-fg-muted">Name</label>
              <input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setNewSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '')
                  )
                }}
                required
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg-muted">Slug</label>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                required
                pattern="[a-z0-9][a-z0-9-]*"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-fg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
