import { AgentQuery, createCollaborativeHandler } from '@xzawed/agent-streams'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { ClarificationNeeded } from './claude/runner.js'
import type { ManagerToPlannerMessage, PlannerToManagerMessage } from './types.js'

type PlannerPayload = ManagerToPlannerMessage['payload']

export class Planner {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner
  ) {}

  async handle(message: ManagerToPlannerMessage): Promise<void> {
    await createCollaborativeHandler<PlannerToManagerMessage, PlannerPayload>({
      publish: (sid, m) => this.producer.publish(sid, m),
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      completeType: 'plan_complete',
      runMain: async (payload, base) => {
        const result = await this.runner.generatePlan(
          payload.intent, payload.context, payload.priority, payload.clarificationContext,
        )
        if (result instanceof AgentQuery) return result
        if (result instanceof ClarificationNeeded) {
          return {
            publishResult: () => this.producer.publish(base.sessionId, {
              ...base,
              type: 'info_request',
              payload: { content: result.question, uiSpec: { type: 'form', fields: result.fields } },
            }),
          }
        }
        return {
          publishResult: () => this.producer.publish(base.sessionId, {
            ...base,
            type: 'plan_complete',
            payload: {
              steps: result.steps,
              estimatedTime: result.estimatedTime,
              ...(result.knowledge ? { knowledge: result.knowledge } : {}),
              content: `계획 완료: ${result.steps.length}단계, 예상 소요 ${result.estimatedTime}`,
            },
          }),
        }
      },
      publishAgentQuery: (aq, base, sid) => this.producer.publish(sid, {
        ...base,
        type: 'agent_query',
        payload: { content: aq.question, to: aq.to, question: aq.question, kind: aq.kind },
      }),
    })(message)
  }
}
