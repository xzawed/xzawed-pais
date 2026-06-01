/** Anthropic 클라이언트의 최소 구조적 인터페이스(에이전트 간 질의 답변용). */
export interface ClaudeLike {
  messages: {
    create(args: {
      model: string
      max_tokens: number
      system: string
      messages: { role: 'user'; content: string }[]
    }): Promise<{ content: { type: string; text?: string }[] }>
  }
}

/**
 * 다른 에이전트의 질의(query)에 Claude로 답하는 공통 로직.
 * Designer/Developer 등 여러 에이전트가 system 프롬프트만 달리해 재사용한다(중복 방지).
 */
export async function answerViaClaude(
  client: ClaudeLike,
  model: string,
  systemPrompt: string,
  query: string,
  context: Record<string, unknown>,
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Question: ${query}\n\nContext: ${JSON.stringify(context, null, 2)}` }],
  })
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}
