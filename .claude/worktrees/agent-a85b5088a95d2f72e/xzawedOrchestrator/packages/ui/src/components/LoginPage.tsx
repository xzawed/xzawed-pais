import React, { useState } from 'react'
import { useAuthStore } from '../stores/auth.store.js'
import { AuthCard, FormField, SubmitButton, FormError } from './AuthForm.js'

interface Props {
  serverUrl: string
  onSuccess: () => void
  onRegister: () => void
}

export function LoginPage({ serverUrl, onSuccess, onRegister }: Readonly<Props>): React.JSX.Element {
  const { login, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.SyntheticEvent): Promise<void> => {
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
    <AuthCard title="Sign in" subtitle="xzawed PAIS">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormError message={error} />
        <FormField label="Email" type="email" value={email} onChange={setEmail} required />
        <FormField label="Password" type="password" value={password} onChange={setPassword} required />
        <SubmitButton isLoading={isLoading} label="Sign in" loadingLabel="Signing in…" />
      </form>
      <p className="text-center text-sm text-fg-muted">
        {"Don't have an account? "}
        <button type="button" onClick={onRegister} className="text-accent hover:underline">
          Register
        </button>
      </p>
    </AuthCard>
  )
}
