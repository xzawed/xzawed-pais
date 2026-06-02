import { callClaudeText, stripJsonFences, type ClaudeLike } from './answer-query.js'

/** {"knowledge": [...]} 객체에서 문자열 배열만 추출한다. 실패 시 빈 배열. */
export function parseKnowledgeArray(text: string): string[] {
  const cleaned = stripJsonFences(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null) return []
    const raw = (parsed as Record<string, unknown>)['knowledge']
    if (!Array.isArray(raw)) return []
    return raw.filter((k): k is string => typeof k === 'string')
  } catch {
    return []
  }
}

/**
 * Claude를 호출해 실행 출력에서 지속적(durable) 도메인 지식만 추출한다.
 * 프롬프트는 호출자(서비스)가 제공한다. 지식이 없거나 호출 실패 시 빈 배열을 반환한다.
 */
export async function extractKnowledgeViaClaude(
  client: ClaudeLike,
  model: string,
  prompt: string,
  output: string,
  timeoutMs: number,
): Promise<string[]> {
  try {
    const text = await callClaudeText(client, model, 1024, prompt, output.slice(0, 8000), timeoutMs)
    return parseKnowledgeArray(text)
  } catch {
    return []
  }
}
