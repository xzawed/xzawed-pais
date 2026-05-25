import React, { useState } from 'react'
import type { UISpec, UIField } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { postMessage } from '../lib/api.js'
import { Button } from './ui/button.js'

interface FieldProps {
  field: UIField
  value: string
  onChange: (val: string) => void
}

const inputClass =
  'w-full rounded border border-border bg-code px-2.5 py-1.5 text-[11px] text-fg outline-none focus:border-accent/60 transition-colors'

function FormField({ field, value, onChange }: Readonly<FieldProps>): React.JSX.Element {
  if (field.type === 'textarea') {
    return (
      <div className="mb-3">
        <label className="block text-[10px] text-fg-ghost mb-1">
          {field.label}{field.required ? ' *' : ''}
        </label>
        <textarea
          className={inputClass}
          value={value}
          placeholder={field.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <div className="mb-3">
        <label className="block text-[10px] text-fg-ghost mb-1">
          {field.label}{field.required ? ' *' : ''}
        </label>
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
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
      <div className="mb-3">
        <label className="block text-[10px] text-fg-ghost mb-1">
          {field.label}{field.required ? ' *' : ''}
        </label>
        <input
          type="number"
          className={inputClass}
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
      <div className="mb-3">
        <label className="block text-[10px] text-fg-ghost mb-1">
          {field.label}{field.required ? ' *' : ''}
        </label>
        {field.options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 mt-1 text-[11px] text-fg-ghost font-normal">
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
    <div className="mb-3">
      <label className="block text-[10px] text-fg-ghost mb-1">
        {field.label}{field.required ? ' *' : ''}
      </label>
      <input
        type="text"
        className={inputClass}
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

function FormPanel({ spec }: Readonly<FormPanelProps>): React.JSX.Element {
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
    <div className="flex flex-1 flex-col">
      <div className="border-b border-border px-4 py-2 text-[13px] font-semibold text-fg">
        {spec.title ?? 'Form'}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {(spec.fields ?? []).map((field) => (
          <FormField
            key={field.id}
            field={field}
            value={values[field.id] ?? ''}
            onChange={(val) => setValue(field.id, val)}
          />
        ))}
        <Button onClick={handleSubmit} disabled={submitting} className="mt-2 w-full">
          {submitting ? 'Submitting…' : (spec.submitAction ?? 'Submit')}
        </Button>
      </div>
    </div>
  )
}

const panelClass = 'flex w-[280px] flex-shrink-0 flex-col border-l border-border bg-surface overflow-hidden'
const headerClass = 'border-b border-border px-4 py-2 text-[13px] font-semibold text-fg'

function EmptyPanel(): React.JSX.Element {
  return (
    <div className={panelClass}>
      <div className={headerClass}>Context</div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-fg-ghost">
          No active context. Start chatting to see dynamic panels here.
        </p>
      </div>
    </div>
  )
}

function MockupViewerPanel({ spec }: Readonly<{ spec: UISpec }>): React.JSX.Element {
  return (
    <div className={panelClass}>
      <div className={headerClass}>{spec.title ?? 'Mockup'}</div>
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="text-[12px] text-fg-ghost whitespace-pre-wrap break-words">
          {spec.content ?? ''}
        </pre>
      </div>
    </div>
  )
}

function ProgressBoardPanel({ spec }: Readonly<{ spec: UISpec }>): React.JSX.Element {
  return (
    <div className={panelClass}>
      <div className={headerClass}>{spec.title ?? 'Progress'}</div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-fg-ghost">{spec.content ?? 'Working…'}</p>
      </div>
    </div>
  )
}

export function DynamicPanel(): React.JSX.Element {
  const { uiSpec } = useChatStore()

  if (!uiSpec) return <EmptyPanel />

  if (uiSpec.type === 'form') {
    return (
      <div className={panelClass}>
        <FormPanel spec={uiSpec as UISpec & { type: 'form' }} />
      </div>
    )
  }

  if (uiSpec.type === 'mockup_viewer') return <MockupViewerPanel spec={uiSpec} />

  if (uiSpec.type === 'progress_board') return <ProgressBoardPanel spec={uiSpec} />

  return (
    <div className={panelClass}>
      <div className={headerClass}>Context</div>
    </div>
  )
}
