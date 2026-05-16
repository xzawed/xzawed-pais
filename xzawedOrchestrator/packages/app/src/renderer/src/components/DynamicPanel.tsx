import React, { useState } from 'react'
import type { UISpec, UIField } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { postMessage } from '../lib/api.js'

interface FieldProps {
  field: UIField
  value: string
  onChange: (val: string) => void
}

function FormField({ field, value, onChange }: FieldProps): React.JSX.Element {
  if (field.type === 'textarea') {
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        <textarea
          value={value}
          placeholder={field.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        <input
          type="number"
          value={value}
          placeholder={field.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'checkbox_group' && field.options) {
    const checked: string[] = value ? value.split(',') : []
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        {field.options.map((opt) => (
          <label key={opt.value} style={{ display: 'flex', gap: 6, marginTop: 4, fontWeight: 'normal', color: '#ccc' }}>
            <input
              type="checkbox"
              checked={checked.includes(opt.value)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...checked, opt.value]
                  : checked.filter((v) => v !== opt.value)
                onChange(next.join(','))
              }}
            />
            {opt.label}
          </label>
        ))}
      </div>
    )
  }

  // Default: text
  return (
    <div className="form-field">
      <label>{field.label}{field.required ? ' *' : ''}</label>
      <input
        type="text"
        value={value}
        placeholder={field.placeholder ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

interface FormPanelProps {
  spec: UISpec & { type: 'form' }
}

function FormPanel({ spec }: FormPanelProps): React.JSX.Element {
  const { sessionId } = useChatStore()
  const { settings } = useAppStore()
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  function setValue(id: string, val: string): void {
    setValues((prev) => ({ ...prev, [id]: val }))
  }

  async function handleSubmit(): Promise<void> {
    if (!sessionId || submitting) return
    setSubmitting(true)
    try {
      const content = JSON.stringify({ action: spec.submitAction ?? 'submit', values })
      await postMessage(settings.serverUrl, sessionId, content)
    } catch {
      // Swallow — ChatView WS will surface any error
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h3>{spec.title ?? 'Form'}</h3>
      {(spec.fields ?? []).map((field) => (
        <FormField
          key={field.id}
          field={field}
          value={values[field.id] ?? ''}
          onChange={(val) => setValue(field.id, val)}
        />
      ))}
      <button className="form-submit-btn" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Submitting…' : (spec.submitAction ?? 'Submit')}
      </button>
    </div>
  )
}

export function DynamicPanel(): React.JSX.Element {
  const { uiSpec } = useChatStore()

  if (!uiSpec) {
    return (
      <div className="dynamic-panel">
        <h3>Context</h3>
        <p style={{ color: '#4a4a6a', fontSize: 13 }}>
          No active context. Start chatting to see dynamic panels here.
        </p>
      </div>
    )
  }

  if (uiSpec.type === 'form') {
    return (
      <div className="dynamic-panel">
        <FormPanel spec={uiSpec as UISpec & { type: 'form' }} />
      </div>
    )
  }

  if (uiSpec.type === 'mockup_viewer') {
    return (
      <div className="dynamic-panel">
        <h3>{uiSpec.title ?? 'Mockup'}</h3>
        <pre style={{ fontSize: 12, color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {uiSpec.content ?? ''}
        </pre>
      </div>
    )
  }

  if (uiSpec.type === 'progress_board') {
    return (
      <div className="dynamic-panel">
        <h3>{uiSpec.title ?? 'Progress'}</h3>
        <p style={{ fontSize: 13, color: '#ccc' }}>{uiSpec.content ?? 'Working…'}</p>
      </div>
    )
  }

  return (
    <div className="dynamic-panel">
      <h3>Context</h3>
    </div>
  )
}
