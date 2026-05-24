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
          content: `Summarize the core development task in 1-2 sentences from the following text. Write only the task description without any explanation:\n\n${rawResponse}`,
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
