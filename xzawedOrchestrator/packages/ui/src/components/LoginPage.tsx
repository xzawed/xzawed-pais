import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.store.js'
import { AuthCard, FormField, SubmitButton, FormError } from './AuthForm.js'

interface Props {
  serverUrl: string
  onSuccess: () => void
  onRegister: () => void
}

export function LoginPage({ serverUrl, onSuccess, onRegister }: Readonly<Props>): React.JSX.Element {
  const { t } = useTranslation('ui')
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
      setError(err instanceof Error ? err.message : t('login.error_invalid'))
    }
  }

  return (
    <AuthCard title={t('login.title')} subtitle="xzawed PAIS">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormError message={error} data-testid="login-error" />
        <FormField
          label={t('login.email')}
          type="email"
          value={email}
          onChange={setEmail}
          required
          data-testid="login-email"
        />
        <FormField
          label={t('login.password')}
          type="password"
          value={password}
          onChange={setPassword}
          required
          data-testid="login-password"
        />
        <SubmitButton
          isLoading={isLoading}
          label={t('login.submit')}
          loadingLabel="..."
          data-testid="login-submit"
        />
      </form>
      <p className="text-center text-sm text-fg-muted">
        {"Don't have an account? "}
        <button
          type="button"
          onClick={onRegister}
          className="text-accent hover:underline"
          data-testid="login-go-register"
        >
          {t('login.go_register')}
        </button>
      </p>
    </AuthCard>
  )
}
