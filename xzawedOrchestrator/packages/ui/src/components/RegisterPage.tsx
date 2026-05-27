import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.store.js'
import { AuthCard, FormField, SubmitButton, FormError } from './AuthForm.js'

interface Props {
  serverUrl: string
  onSuccess: () => void
  onLogin: () => void
}

export function RegisterPage({ serverUrl, onSuccess, onLogin }: Readonly<Props>): React.JSX.Element {
  const { t } = useTranslation('ui')
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
      setError(err instanceof Error ? err.message : t('register.error_exists'))
    }
  }

  return (
    <AuthCard title={t('register.title')} subtitle="xzawed PAIS">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormError message={error} data-testid="register-error" />
        <FormField label="Display name" type="text" value={displayName} onChange={setDisplayName} />
        <FormField
          label={t('register.email')}
          type="email"
          value={email}
          onChange={setEmail}
          required
          data-testid="register-email"
        />
        <FormField
          label={t('register.password')}
          type="password"
          value={password}
          onChange={setPassword}
          required
          minLength={8}
          data-testid="register-password"
        />
        <SubmitButton
          isLoading={isLoading}
          label={t('register.submit')}
          loadingLabel="..."
          data-testid="register-submit"
        />
      </form>
      <p className="text-center text-sm text-fg-muted">
        {'Already have an account? '}
        <button
          type="button"
          onClick={onLogin}
          className="text-accent hover:underline"
          data-testid="register-go-login"
        >
          {t('register.go_login')}
        </button>
      </p>
    </AuthCard>
  )
}
