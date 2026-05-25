import React, { useState } from 'react'
import { useAuthStore } from '../stores/auth.store.js'
import { AuthCard, FormField, SubmitButton, FormError } from './AuthForm.js'

interface Props {
  serverUrl: string
  onSuccess: () => void
  onLogin: () => void
}

export function RegisterPage({ serverUrl, onSuccess, onLogin }: Readonly<Props>): React.JSX.Element {
  const { register, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await register(serverUrl, email, password, displayName || undefined)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    }
  }

  return (
    <AuthCard title="Create account" subtitle="xzawed PAIS">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormError message={error} />
        <FormField label="Display name" type="text" value={displayName} onChange={setDisplayName} />
        <FormField label="Email" type="email" value={email} onChange={setEmail} required />
        <FormField label="Password" type="password" value={password} onChange={setPassword} required minLength={8} />
        <SubmitButton isLoading={isLoading} label="Create account" loadingLabel="Creating…" />
      </form>
      <p className="text-center text-sm text-fg-muted">
        {'Already have an account? '}
        <button type="button" onClick={onLogin} className="text-accent hover:underline">
          Sign in
        </button>
      </p>
    </AuthCard>
  )
}
