import { AgentQuery } from '../types/agent-query.js'

/** runMain의 결과: 다른 에이전트 질의(AgentQuery) 또는 정상 산출물(publish 콜백). */
export type MainOutcome = AgentQuery | { readonly publishResult: () => Promise<void> }

/** 모든 {agent}:to-manager 메시지의 공통 형태. */
export interface CollabMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: string
  payload: Record<string, unknown>
}

/** handle 1회의 메시지 base(sessionId·messageId·timestamp). */
export interface MessageBase {
  sessionId: string
  messageId: string
  timestamp: number
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

/**
 * 협업 handle의 공통 컨텍스트를 만든다: 메시지 base + 완료/에러 발행 콜백.
 * 7개 에이전트가 동일 boilerplate(base 생성·publishQueryAnswer·publishError)를 재사용한다.
 */
export function makeCollaborationContext<TMsg extends CollabMessage>(
  publish: (msg: TMsg) => Promise<void>,
  sessionId: string,
  completeType: string,
): {
  base: MessageBase
  publishQueryAnswer: (content: string) => Promise<void>
  publishError: (content: string) => Promise<void>
} {
  const base: MessageBase = { sessionId, messageId: crypto.randomUUID(), timestamp: Date.now() }
  return {
    base,
    publishQueryAnswer: (content) => publish({ ...base, type: completeType, payload: { content } } as unknown as TMsg),
    publishError: (content) => publish({ ...base, type: 'error', payload: { content } } as unknown as TMsg),
  }
}

/**
 * 협업 에이전트의 공통 handle 골격.
 * abort → 종료, query 모드 → answerQuery로 답, 정상 → runMain 후
 * AgentQuery면 질의 발행 / 산출물이면 결과 발행. 예외는 모두 error로 발행한다.
 * 에이전트 고유 로직은 콜백으로 주입해 7개 에이전트가 동일 골격을 재사용한다(중복 방지).
 */
export async function runCollaborativeHandle(opts: {
  isAbort: boolean
  query: string | undefined
  context: Record<string, unknown>
  answerQuery: (query: string, context: Record<string, unknown>) => Promise<string>
  publishQueryAnswer: (content: string) => Promise<void>
  runMain: () => Promise<MainOutcome>
  /** AgentQuery 발생을 지원하는 에이전트만 제공. 없으면 질의 발생 시 error로 처리. */
  publishAgentQuery?: (aq: AgentQuery) => Promise<void>
  publishError: (content: string) => Promise<void>
}): Promise<void> {
  if (opts.isAbort) return

  if (opts.query !== undefined) {
    try {
      const answer = await opts.answerQuery(opts.query, opts.context)
      await opts.publishQueryAnswer(answer)
    } catch (err: unknown) {
      await opts.publishError(errMessage(err))
    }
    return
  }

  try {
    const outcome = await opts.runMain()
    if (outcome instanceof AgentQuery) {
      if (opts.publishAgentQuery) {
        await opts.publishAgentQuery(outcome)
      } else {
        await opts.publishError(`Agent query not supported by this agent: ${outcome.question}`)
      }
    } else {
      await outcome.publishResult()
    }
  } catch (err: unknown) {
    await opts.publishError(errMessage(err))
  }
}
