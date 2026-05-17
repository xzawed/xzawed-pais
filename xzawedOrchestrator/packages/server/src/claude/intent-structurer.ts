import Anthropic from '@anthropic-ai/sdk'

export async function structureIntent(
  rawResponse: string,
  client: Anthropic,
  model: string,
): Promise<string> {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `다음 텍스트에서 수행해야 할 핵심 개발 작업을 1-2문장으로 요약하세요. 설명 없이 작업 내용만 작성하세요:\n\n${rawResponse}`,
        },
      ],
    })
    const block = response.content[0]
    if (block?.type === 'text' && block.text.trim()) {
      return block.text.trim()
    }
  } catch {
    // Fall through to fallback
  }
  return rawResponse
}
