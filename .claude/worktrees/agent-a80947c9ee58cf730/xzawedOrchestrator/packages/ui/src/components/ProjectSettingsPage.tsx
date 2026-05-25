import React, { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth.store.js'

interface Props {
  serverUrl: string
  projectId: string
  onBack: () => void
}

async function fetchTokenStatus(serverUrl: string, projectId: string, token: string): Promise<boolean> {
  const res = await fetch(`${serverUrl}/projects/${projectId}/github-token/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch token status')
  const data = (await res.json()) as { exists: boolean }
  return data.exists
}

async function saveToken(serverUrl: string, projectId: string, token: string, pat: string): Promise<void> {
  const res = await fetch(`${serverUrl}/projects/${projectId}/github-token`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pat }),
  })
  if (!res.ok) throw new Error('Failed to save token')
}

async function removeToken(serverUrl: string, projectId: string, token: string): Promise<void> {
  const res = await fetch(`${serverUrl}/projects/${projectId}/github-token`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to delete token')
}

function TokenStatusBadge({ exists }: Readonly<{ exists: boolean | null }>): React.JSX.Element {
  if (exists === null) return <span className="text-sm text-fg-muted">Loading…</span>
  if (exists) return <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Registered</span>
  return <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-fg-muted">Not registered</span>
}

export function ProjectSettingsPage({ serverUrl, projectId, onBack }: Readonly<Props>): React.JSX.Element {
  const { accessToken } = useAuthStore()
  const [exists, setExists] = useState<boolean | null>(null)
  const [pat, setPat] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    fetchTokenStatus(serverUrl, projectId, accessToken)
      .then(setExists)
      .catch(() => setExists(false))
  }, [serverUrl, projectId, accessToken])

  const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!accessToken || !pat.trim()) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await saveToken(serverUrl, projectId, accessToken, pat)
      setExists(true)
      setPat('')
      setSuccess('GitHub token saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!accessToken) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await removeToken(serverUrl, projectId, accessToken)
      setExists(false)
      setSuccess('GitHub token removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen overflow-auto bg-bg p-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-fg-muted hover:text-fg"
          >
            ← Back
          </button>
          <h1 className="text-xl font-semibold text-fg">Project Settings</h1>
        </div>

        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 text-base font-medium text-fg">GitHub Token</h2>
          <p className="mb-4 text-sm text-fg-muted">
            Personal Access Token for GitHub operations in this project.
          </p>

          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-fg-muted">Status:</span>
            <TokenStatusBadge exists={exists} />
          </div>

          <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-3">
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
              className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving || !pat.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Token'}
              </button>
              {exists && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-fg-muted hover:text-error disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </form>

          {error && <p className="mt-3 text-sm text-error">{error}</p>}
          {success && <p className="mt-3 text-sm text-success">{success}</p>}
        </section>
      </div>
    </div>
  )
}
