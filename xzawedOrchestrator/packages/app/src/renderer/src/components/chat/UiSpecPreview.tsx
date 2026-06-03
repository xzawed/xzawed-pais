import React from 'react'
import type { UISpec, UIField } from '@xzawed/shared'
import { MarkdownContent } from './MarkdownContent.js'

/**
 * 승인 게이트에서 디자인 산출물(UISpec)을 **읽기 전용**으로 미리보여 주는 데모 렌더러.
 * DynamicPanel(대화형 입력)과 달리 상호작용 없이 구조만 보여 준다 — 사용자가 승인 시점에 데모를 검토.
 */
function FieldRow({ field }: Readonly<{ field: UIField }>): React.JSX.Element {
  return (
    <li className="flex flex-col gap-0.5 rounded border border-border bg-bg px-2 py-1">
      <span className="text-[11px] text-fg">
        {field.label}{field.required ? ' *' : ''}
        <span className="ml-1.5 text-[9px] text-fg-ghost uppercase">{field.type}</span>
      </span>
      {field.options && field.options.length > 0 && (
        <span className="text-[10px] text-fg-ghost">
          {field.options.map((o) => o.label).join(' · ')}
        </span>
      )}
      {field.placeholder && (
        <span className="text-[10px] text-fg-ghost italic">{field.placeholder}</span>
      )}
    </li>
  )
}

export function UiSpecPreview({ spec }: Readonly<{ spec: UISpec }>): React.JSX.Element {
  return (
    <div
      data-testid="uispec-preview"
      className="rounded border border-border bg-surface-raised px-2.5 py-2 flex flex-col gap-1.5"
    >
      <div className="text-[10px] font-medium text-fg-dim uppercase tracking-wide">
        {spec.title ?? spec.type}
      </div>

      {spec.type === 'form' && (
        <ul className="flex flex-col gap-1">
          {(spec.fields ?? []).map((field) => (
            <FieldRow key={field.id} field={field} />
          ))}
        </ul>
      )}

      {(spec.type === 'mockup_viewer' || spec.type === 'progress_board') && (
        // content를 마크다운으로 리치 렌더(제목·목록·표·강조·코드) — 단순 raw 텍스트 대신 구조를 시각화.
        <MarkdownContent content={spec.content ?? ''} />
      )}
    </div>
  )
}
