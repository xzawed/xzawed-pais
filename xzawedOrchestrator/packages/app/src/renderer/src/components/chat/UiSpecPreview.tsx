import React from 'react'
import type { UISpec, UIField, ComponentSpec } from '@xzawed/shared'
import { MarkdownContent } from './MarkdownContent.js'

/**
 * 승인 게이트에서 디자인 산출물(UISpec)을 **읽기 전용**으로 미리보여 주는 데모 렌더러.
 * DynamicPanel(대화형 입력)과 달리 상호작용 없이 구조만 보여 준다 — 사용자가 승인 시점에 데모를 검토.
 */

/** Designer 컴포넌트 트리 노드를 중첩 박스 와이어프레임으로 재귀 렌더(읽기 전용). */
function ComponentNode({ node }: Readonly<{ node: ComponentSpec }>): React.JSX.Element {
  return (
    <div className="rounded border border-border bg-bg px-2 py-1 flex flex-col gap-0.5">
      <span className="text-[11px] leading-tight">
        <span className="font-medium text-fg">{node.name}</span>
        {node.cssClasses && node.cssClasses.length > 0 && (
          <span className="ml-1.5 text-[9px] text-fg-ghost">.{node.cssClasses.join('.')}</span>
        )}
      </span>
      {node.description && (
        <span className="text-[10px] text-fg-ghost">{node.description}</span>
      )}
      {node.children && node.children.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 pl-2 border-l border-border">
          {node.children.map((child, i) => (
            <ComponentNode key={`${child.name}-${i}`} node={child} />
          ))}
        </div>
      )}
    </div>
  )
}
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

      {/* Designer 컴포넌트 트리(있으면): 중첩 박스 와이어프레임 — 비전의 '구현 전 데모 시연' 풀버전 */}
      {spec.components && spec.components.length > 0 && (
        <div data-testid="uispec-components" className="flex flex-col gap-1">
          {spec.components.map((node, i) => (
            <ComponentNode key={`${node.name}-${i}`} node={node} />
          ))}
        </div>
      )}
    </div>
  )
}
