import React from 'react'
import type { ComponentSpec } from '@xzawed/shared'
import { getProp, splitItems } from './props.js'

/** 렌더러: 노드 + (이미 렌더된) 자식 노드들을 받아 styled 엘리먼트를 반환. */
export type Renderer = (node: ComponentSpec, children: React.ReactNode) => React.JSX.Element

const card: Renderer = (node, children) => (
  <div className="rounded-md border border-border bg-surface p-3 flex flex-col gap-2">
    {getProp(node, 'title') && <div className="text-[12px] font-semibold text-fg">{getProp(node, 'title')}</div>}
    {children}
  </div>
)

const stack: Renderer = (_node, children) => <div className="flex flex-col gap-2">{children}</div>
const row: Renderer = (_node, children) => <div className="flex flex-row items-center gap-2">{children}</div>

const input: Renderer = (node) => (
  <div className="flex flex-col gap-1">
    {getProp(node, 'label') && <span className="text-[11px] text-fg-dim">{getProp(node, 'label')}</span>}
    <input
      disabled
      type={getProp(node, 'type') ?? 'text'}
      placeholder={getProp(node, 'placeholder', 'value') ?? ''}
      className="rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg placeholder:text-fg-ghost"
    />
  </div>
)

const textarea: Renderer = (node) => (
  <div className="flex flex-col gap-1">
    {getProp(node, 'label') && <span className="text-[11px] text-fg-dim">{getProp(node, 'label')}</span>}
    <textarea
      disabled
      rows={3}
      placeholder={getProp(node, 'placeholder') ?? ''}
      className="resize-none rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg placeholder:text-fg-ghost"
    />
  </div>
)

const select: Renderer = (node) => (
  <div className="flex flex-col gap-1">
    {getProp(node, 'label') && <span className="text-[11px] text-fg-dim">{getProp(node, 'label')}</span>}
    <select disabled className="rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg">
      {splitItems(getProp(node, 'options')).map((o, i) => (
        <option key={i}>{o}</option>
      ))}
    </select>
  </div>
)

const checkbox: Renderer = (node) => (
  <label className="flex items-center gap-1.5 text-[12px] text-fg">
    <input disabled type="checkbox" className="accent-accent" />
    {getProp(node, 'label', 'text') ?? ''}
  </label>
)

const button: Renderer = (node) => {
  const variant = getProp(node, 'variant')
  const cls =
    variant === 'secondary'
      ? 'border border-border bg-surface text-fg'
      : variant === 'ghost'
        ? 'text-accent'
        : 'bg-accent text-white'
  return (
    <button type="button" disabled className={`h-8 px-3 rounded text-[12px] self-start ${cls}`}>
      {getProp(node, 'label', 'text') ?? 'Button'}
    </button>
  )
}

const label: Renderer = (node) => (
  <span className="text-[11px] font-medium text-fg-dim">{getProp(node, 'text', 'label') ?? node.description}</span>
)

const heading: Renderer = (node) => {
  const level = getProp(node, 'level')
  const size = level === '1' ? 'text-[16px]' : level === '3' ? 'text-[12px]' : 'text-[14px]'
  return <div className={`font-semibold text-fg ${size}`}>{getProp(node, 'text', 'title') ?? node.description}</div>
}

const text: Renderer = (node) => (
  <p className="text-[12px] text-fg-muted">{getProp(node, 'text', 'content') ?? node.description}</p>
)

const badge: Renderer = (node) => (
  <span className="inline-flex w-fit items-center rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] text-fg-dim">
    {getProp(node, 'text', 'label') ?? node.description}
  </span>
)

const list: Renderer = (node, children) => {
  const items = splitItems(getProp(node, 'items'))
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-fg-muted">
      {items.length > 0 ? items.map((it, i) => <li key={i}>{it}</li>) : children}
    </ul>
  )
}

const table: Renderer = (node) => {
  const cols = splitItems(getProp(node, 'columns'))
  const header = cols.length > 0 ? cols : ['—']
  return (
    <table className="w-full border border-border text-[11px]">
      {cols.length > 0 && (
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} className="border border-border bg-surface px-2 py-1 text-left text-fg-dim">{c}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        <tr>
          {header.map((_, i) => (
            <td key={i} className="border border-border px-2 py-1 text-fg-ghost">—</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

const divider: Renderer = () => <hr className="border-border" />

export const RENDERERS: Record<string, Renderer> = {
  card, stack, row, input, textarea, select, checkbox, button,
  label, heading, text, badge, list, table, divider,
}
