/** Manager가 주입한 도메인 지식 항목(content + 산출 에이전트). */
interface KnowledgeItem {
  content: string
  sourceAgent?: string
}

function isKnowledgeItem(v: unknown): v is KnowledgeItem {
  return typeof v === 'object' && v !== null && typeof (v as { content?: unknown }).content === 'string'
}

/**
 * context.domainKnowledge(Manager 주입)를 LLM 프롬프트용 라벨 블록으로 렌더한다.
 * 없거나 비면 빈 문자열을 반환해 프롬프트에 영향이 없도록 한다.
 * 에이전트가 이전 프로젝트 결정·제약을 존중·활용하도록 first-class 섹션으로 노출한다.
 */
export function formatDomainKnowledge(context: Record<string, unknown>): string {
  const raw = context['domainKnowledge']
  if (!Array.isArray(raw) || raw.length === 0) return ''
  const lines = raw
    .filter(isKnowledgeItem)
    .map((e) => `- ${e.content}${e.sourceAgent ? ` (${e.sourceAgent})` : ''}`)
  if (lines.length === 0) return ''
  return `## 이전 프로젝트 도메인 지식 (반드시 존중하고 활용)\n${lines.join('\n')}`
}
