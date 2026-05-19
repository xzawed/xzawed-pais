import React from 'react'

export function AuthCard({
  title,
  subtitle,
  children,
}: Readonly<{
  title: string
  subtitle: string
  children: React.ReactNode
}>): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-surface p-8">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function FormField({
  label,
  type,
  value,
  onChange,
  required,
  minLength,
}: Readonly<{
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  minLength?: number
}>): React.JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-accent"
      />
    </div>
  )
}

export function SubmitButton({
  isLoading,
  label,
  loadingLabel,
}: Readonly<{
  isLoading: boolean
  label: string
  loadingLabel: string
}>): React.JSX.Element {
  return (
    <button
      type="submit"
      disabled={isLoading}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {isLoading ? loadingLabel : label}
    </button>
  )
}

export function FormError({ message }: Readonly<{ message: string | null }>): React.JSX.Element | null {
  if (message === null) return null
  return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>
}
