import React, { useState } from 'react'
import { useAuthStore } from '../stores/auth.store.js'

interface Props {
  serverUrl: string
  onSuccess: () => void
  onRegister: () => void
}

export function LoginPage({ serverUrl, onSuccess, onRegister }: Props): React.JSX.Element {
  const { login, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await login(serverUrl, email, password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-surface p-8">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Sign in</h1>
          <p className="mt-1 text-sm text-fg-muted">xzawed PAIS</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error !== null && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-fg-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg-muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-sm text-fg-muted">
          {"Don't have an account? "}
          <button type="button" onClick={onRegister} className="text-accent hover:underline">
            Register
          </button>
        </p>
      </div>
    </div>
  )
}
