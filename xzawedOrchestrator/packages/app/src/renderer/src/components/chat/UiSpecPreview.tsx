import React from 'react'
import type { UISpec, UIField, ComponentSpec } from '@xzawed/shared'
import { useTranslation } from 'react-i18next'
import { MarkdownContent } from './MarkdownContent.js'
import { RENDERERS } from './uispec/registry.js'
import { normalizeName } from './uispec/props.js'

/**
 * 승인 게이트에서 디자인 산출물(UISpec)을 **읽기 전용**으로 미리보여 주는 Spec 인터프리터.
 * 구조화된 ComponentSpec 트리를 디자인시스템 기반 styled React로 매핑(HTML 주입 없음).
 */

const MAX_DEPTH = 20

/** 미지원 name 폴백: 점선 박스에 name·description·자식을 표시(graceful degrade). */
function FallbackNode({ node, children }: Readonly<{ node: ComponentSpec; children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-dashed border-border bg-bg px-2 py-1">
      <span className="text-[11px] font-medium text-fg">{node.name}</span>
      {node.description && <span className="text-[10px] text-fg-ghost">{node.description}</span>}
      {children && <div className="mt-1 flex flex-col gap-1 border-l border-border pl-2">{children}</div>}
    </div>
  )
}

/** ComponentSpec 노드를 레지스트리로 재귀 렌더(깊이 상한으로 순환·악성 스펙 방어). */
function renderNode(node: ComponentSpec, depth: number): React.ReactNode {
  if (depth > MAX_DEPTH) return null
  const children =
    node.children && node.children.length > 0
      ? node.children.map((c, i) => <React.Fragment key={`${c.name}-${i}`}>{renderNode(c, depth + 1)}</React.Fragment>)
      : null
  const renderer = RENDERERS[normalizeName(node.name)]
  if (renderer) return renderer(node, children)
  return <FallbackNode node={node}>{children}</FallbackNode>
}

/** form fields를 비활성 styled 입력으로 렌더(읽기전용 데모). */
function FieldControl({ field }: Readonly<{ field: UIField }>): React.JSX.Element {
  if (field.type === 'textarea') {
    return (
      <textarea
        disabled
        rows={2}
        placeholder={field.placeholder ?? ''}
        className="resize-none rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg placeholder:text-fg-ghost"
      />
    )
  }
  if (field.type === 'select' || field.type === 'checkbox_group') {
    return (
      <select disabled className="rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg">
        {(field.options ?? []).map((o) => (
          <option key={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      disabled
      type={field.type === 'number' ? 'number' : 'text'}
      placeholder={field.placeholder ?? ''}
      className="rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg placeholder:text-fg-ghost"
    />
  )
}

function FieldInput({ field }: Readonly<{ field: UIField }>): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-fg-dim">
        {field.label}
        {field.required ? ' *' : ''}
      </span>
      <FieldControl field={field} />
    </div>
  )
}

export function UiSpecPreview({ spec }: Readonly<{ spec: UISpec }>): React.JSX.Element {
  const { t } = useTranslation('app')
  const hasComponents = !!spec.components && spec.components.length > 0
  const hasFields = spec.type === 'form' && !!spec.fields && spec.fields.length > 0
  const hasContent = (spec.type === 'mockup_viewer' || spec.type === 'progress_board') && !!spec.content
  const empty = !hasComponents && !hasFields && !hasContent

  return (
    <div data-testid="uispec-preview" className="flex flex-col gap-2 rounded border border-border bg-surface-raised px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-dim">{spec.title ?? spec.type}</div>

      {hasFields && (
        <div data-testid="uispec-fields" className="flex flex-col gap-2">
          {spec.fields!.map((f) => (
            <FieldInput key={f.id} field={f} />
          ))}
        </div>
      )}

      {hasContent && <MarkdownContent content={spec.content!} />}

      {hasComponents && (
        <div data-testid="uispec-components" className="flex flex-col gap-2">
          {spec.components!.map((node, i) => (
            <React.Fragment key={`${node.name}-${i}`}>{renderNode(node, 0)}</React.Fragment>
          ))}
        </div>
      )}

      {empty && (
        <span data-testid="uispec-empty" className="text-[11px] text-fg-ghost">
          {t('chat.demo_preview_empty')}
        </span>
      )}
    </div>
  )
}
