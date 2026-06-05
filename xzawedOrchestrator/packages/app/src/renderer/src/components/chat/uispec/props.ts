import type { ComponentSpec } from '@xzawed/shared'

/** props에서 주어진 키들 중 첫 번째 비어있지 않은 문자열 값을 반환. */
export function getProp(node: ComponentSpec, ...keys: string[]): string | undefined {
  if (!node.props) return undefined
  for (const k of keys) {
    const v = node.props[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return undefined
}

/** 쉼표/줄바꿈 구분 문자열을 항목 배열로(list·select·table props용). */
export function splitItems(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s !== '')
}

const ALIAS: Record<string, string> = {
  panel: 'card', box: 'card', container: 'card',
  column: 'stack', vstack: 'stack',
  hstack: 'row', inline: 'row',
  textfield: 'input',
  dropdown: 'select',
  title: 'heading',
  paragraph: 'text',
  tag: 'badge', chip: 'badge',
  separator: 'divider',
}

/** Designer 컴포넌트 name을 레지스트리 키로 정규화(소문자 + 별칭). */
export function normalizeName(name: string): string {
  const n = name.trim().toLowerCase()
  return ALIAS[n] ?? n
}
