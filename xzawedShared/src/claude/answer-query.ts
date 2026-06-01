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

/** Claude 응답 content에서 텍스트 블록만 모아 합친다. */
export function extractClaudeText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

/** Claude가 응답을 감싸는 ```/```json 코드 펜스를 제거한다. */
export function stripJsonFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n')
    cleaned = firstNewline === -1 ? cleaned.slice(3) : cleaned.slice(firstNewline + 1)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, cleaned.lastIndexOf('```')).trim()
  }
  return cleaned
}

/**
 * Claude를 호출해 텍스트를 반환하는 공통 로직(타임아웃 race + 텍스트 추출).
 * 여러 에이전트의 generate 계열·answerQuery가 재사용해 중복을 방지한다.
 */
export async function callClaudeText(
  client: ClaudeLike,
  model: string,
  maxTokens: number,
  system: string,
  userContent: string,
  timeoutMs: number,
): Promise<string> {
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error('Claude API timeout')), timeoutMs)
  })
  timeout.catch(() => {}) // API가 race에서 이기면 unhandled rejection 방지
  try {
    const response = await Promise.race([
      client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
      timeout,
    ])
    return extractClaudeText(response.content)
  } finally {
    clearTimeout(timerId)
  }
}

const ANSWER_TIMEOUT_MS = 120_000

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
  return callClaudeText(
    client,
    model,
    1024,
    systemPrompt,
    `Question: ${query}\n\nContext: ${JSON.stringify(context, null, 2)}`,
    ANSWER_TIMEOUT_MS,
  )
}
