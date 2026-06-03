import type Anthropic from '@anthropic-ai/sdk'

type JsonSchema = Anthropic.Tool['input_schema']

/**
 * LLM이 반환한 tool_use 입력을 핸들러 `inputSchema`(JSON Schema)로 **최소 검증**한다.
 * 에이전트단 Zod 검증의 방어심층 — 잘못된 입력을 디스패치 전에 잡아 Claude에 재시도 신호(is_error)를 준다.
 * (현재 핸들러가 실제 쓰는 JSON Schema 부분집합만 검사: object 여부·required·기본 타입·enum)
 * @returns 위반 메시지 배열. 빈 배열이면 유효.
 */
export function validateToolInput(input: unknown, schema: JsonSchema): string[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['input must be a JSON object']
  }
  const obj = input as Record<string, unknown>
  const s = schema as {
    required?: unknown
    properties?: Record<string, { type?: string; enum?: unknown[] }>
  }
  const errors: string[] = []

  // 필수 필드 — required에 명시됐는데 없거나 null이면 위반
  const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === 'string') : []
  for (const key of required) {
    if (obj[key] === undefined || obj[key] === null) errors.push(`missing required field: ${key}`)
  }

  // 선언된 속성의 기본 타입·enum — 값이 있을 때만 검사(선택 필드 누락은 허용)
  const props = s.properties ?? {}
  for (const [key, def] of Object.entries(props)) {
    const val = obj[key]
    if (val === undefined || val === null) continue
    if (def.type && !matchesJsonType(val, def.type)) {
      errors.push(`field "${key}" must be ${def.type}`)
      continue
    }
    if (Array.isArray(def.enum) && def.enum.length > 0 && !def.enum.includes(val)) {
      errors.push(`field "${key}" must be one of: ${def.enum.join(', ')}`)
    }
  }
  return errors
}

/** JSON Schema 기본 타입 일치 여부. 알 수 없는 타입은 통과(과검증 방지). */
function matchesJsonType(val: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof val === 'string'
    case 'number':
    case 'integer': return typeof val === 'number'
    case 'boolean': return typeof val === 'boolean'
    case 'array': return Array.isArray(val)
    case 'object': return typeof val === 'object' && val !== null && !Array.isArray(val)
    default: return true
  }
}
