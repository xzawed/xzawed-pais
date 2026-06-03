import Anthropic from '@anthropic-ai/sdk'
import type { ToolRegistry } from '../tools/registry.js'
import type { StreamProducer } from '../streams/producer.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { UserContext } from '../types/user-context.js'
import type { ManagerToOrchestratorMessage, UISpec, ComponentSpec } from '../types/streams.js'
import { ClarificationNeededError, AgentQueryError, GateAbortError } from '../tools/errors.js'
import { resolveAgentTool } from '../tools/agent-tool-map.js'
import { isGatedTool, effectiveMode, summarizeOutput, parseDecision, isKnowledgeBearingStage } from '../gates/approval-gate.js'
import type { GateMode } from '../gates/approval-gate.js'
import { validateToolInput } from './validate-tool-input.js'
import type { KnowledgeRepo } from '../db/knowledge.repo.js'

/** MANAGER_MAX_ITERATIONS 환경변수를 파싱하고 유효성을 검증한다. 유효하지 않으면 Error를 throw한다. */
export function parseMaxIterations(raw: string | undefined): number {
  const value = Number(raw ?? '50')
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`MANAGER_MAX_ITERATIONS must be a positive integer, got: ${raw}`)
  }
  return value
}

const MAX_ITERATIONS = parseMaxIterations(process.env['MANAGER_MAX_ITERATIONS'])
const MAX_TOKENS = Number(process.env['MANAGER_MAX_TOKENS'] ?? '16384')
const MAX_GATE_REVISES = Number(process.env['MANAGER_MAX_GATE_REVISES'] ?? '5')
const WIKI_INJECT_LIMIT = Number(process.env['MANAGER_WIKI_INJECT_LIMIT'] ?? '20')
const CLAUDE_CALL_TIMEOUT_MS = Number(process.env['MANAGER_CLAUDE_TIMEOUT_MS'] ?? '120000')

/** knowledge 원소(문자열 또는 {content, category})를 저장용 엔트리로 정규화한다. 유효하지 않으면 null. */
function toKnowledgeEntry(
  raw: unknown,
  sourceAgent: string,
): { content: string; sourceAgent: string; category?: string } | null {
  if (typeof raw === 'string') return { content: raw, sourceAgent }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>
    if (typeof o['content'] === 'string') {
      return typeof o['category'] === 'string'
        ? { content: o['content'], sourceAgent, category: o['category'] }
        : { content: o['content'], sourceAgent }
    }
  }
  return null
}

const REQUEST_INFO_TOOL: Anthropic.Tool = {
  name: 'request_info',
  description: 'Ask the user for additional information needed to complete the task',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to present to the user' },
    },
    required: ['question'],
  },
}

export interface RunnerOptions {
  sessionId: string
  intent: string
  context: Record<string, unknown>
  producer: StreamProducer
  sessionStore: SessionStore
  signal?: AbortSignal
  userContext?: UserContext
  /** 전역 게이트 모드(설정 UI에서 전달) — 이 세션의 기본 승인 모드를 설정한다. */
  gateMode?: GateMode
}

export class ClaudeRunner {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly registry: ToolRegistry,
    private readonly knowledgeRepo?: KnowledgeRepo,
  ) {}

  private async publishStatus(
    producer: StreamProducer,
    sessionId: string,
    content: string,
    type: ManagerToOrchestratorMessage['type'] = 'status_update',
  ): Promise<void> {
    try {
      await producer.publish({
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type,
        payload: { agentId: 'manager', content },
      })
    } catch (err) {
      console.warn('[runner] publishStatus 실패 — 작업 계속:', err)
    }
  }

  /** 위키 지식이 변경됐음을 Orchestrator에 알린다(WikiPanel 실시간 갱신용·비차단). */
  private async publishKnowledgeChanged(
    producer: StreamProducer,
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    try {
      await producer.publish({
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'knowledge_changed',
        payload: { agentId: 'manager', content: '', projectId },
      })
    } catch (err) {
      console.warn('[runner] knowledge_changed 발행 실패 — 작업 계속:', err)
    }
  }

  private async handleRequestInfoTool(
    block: Anthropic.ToolUseBlock,
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const inputObj = block.input as Record<string, unknown>
    if (typeof inputObj['question'] !== 'string') {
      throw new TypeError(`request_info tool call missing required 'question' field`)
    }
    await this.publishStatus(producer, sessionId, inputObj['question'], 'info_request')
    const answer = await sessionStore.waitForInfo(sessionId)
    return { type: 'tool_result', tool_use_id: block.id, content: answer }
  }

  private async handleAgentTool(
    block: Anthropic.ToolUseBlock,
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
    userContext?: UserContext,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const handler = this.registry.get(block.name)
    if (!handler) throw new Error(`Unknown tool: ${block.name}`)

    // LLM tool 입력을 핸들러 inputSchema로 선검증 — 잘못된 입력은 디스패치 없이 is_error로 반환해
    // Claude가 즉시 재시도하게 한다(에이전트단 Zod 거부로 인한 무응답·타임아웃 방지, 방어심층).
    const inputErrors = validateToolInput(block.input, handler.inputSchema)
    if (inputErrors.length > 0) {
      const msg = `Invalid input for ${block.name}: ${inputErrors.join('; ')}`
      await this.publishStatus(producer, sessionId, msg)
      return { type: 'tool_result', tool_use_id: block.id, content: msg, is_error: true }
    }

    await this.publishStatus(producer, sessionId, `Starting ${block.name}...`)
    // 위키 주입: 호출 전 프로젝트 최근 지식을 context.domainKnowledge로 주입
    const input = await this.injectDomainKnowledge(block.input, userContext)
    // ClarificationNeededError는 catch하지 않고 processToolUseBlocks로 전파
    const result = await handler.execute(input, sessionId, userContext)
    // 정상 실행·재실행이 동일 후처리(게이트·위키 저장)를 거치도록 finalizeAgentResult로 통합
    return this.finalizeAgentResult(handler, block, result, sessionId, producer, sessionStore, userContext)
  }

  /**
   * 도구 실행 결과 공통 후처리: 승인 게이트(대상 한정) → 위키 저장 → design_ui 상태 발행 → tool_result.
   * handleAgentTool(정상)과 reExecuteWithContext(명확화·교차질의 재실행)가 공유해,
   * 재실행으로 완성된 산출물도 PO 승인 게이트를 우회하지 않게 한다.
   */
  private async finalizeAgentResult(
    handler: { execute: (i: unknown, s: string, u?: UserContext) => Promise<unknown> },
    block: Anthropic.ToolUseBlock,
    rawResult: unknown,
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
    userContext?: UserContext,
  ): Promise<Anthropic.ToolResultBlockParam> {
    let result = rawResult

    // 코드로 강제하는 승인 게이트 — 에이전트 디스패치 도구에만 적용
    if (isGatedTool(block.name)) {
      result = await this.applyApprovalGate(
        handler, block, result, sessionId, producer, sessionStore, userContext,
      )
    }

    // 위키 저장: 게이트 통과한 결과의 knowledge를 프로젝트 위키에 누적
    const stored = await this.storeDomainKnowledge(block.name, result, userContext)
    if (stored && userContext?.projectId) {
      await this.publishKnowledgeChanged(producer, sessionId, userContext.projectId)
    }

    // design_ui 완료 시 uiSpec을 포함한 상태 업데이트 발행 (게이트 통과한 최종 result 기준)
    if (block.name === 'design_ui') {
      const designResult = result as Record<string, unknown>
      if (designResult['uiSpec'] !== undefined) {
        // Designer 컴포넌트 트리를 uiSpec에 병합해 전달 — 프론트가 리치 데모(중첩 박스)로 렌더(P4)
        const designUiSpec = designResult['uiSpec'] as UISpec
        const components = designResult['components']
        const uiSpec: UISpec = Array.isArray(components) && components.length > 0
          ? { ...designUiSpec, components: components as ComponentSpec[] }
          : designUiSpec
        await producer.publish({
          sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'status_update',
          payload: {
            agentId: 'manager',
            content: `UI 설계 완료: ${String(designResult['content'] ?? '')}`,
            uiSpec,
          },
        })
        return this.toToolResult(block.id, result)
      }
    }

    await this.publishStatus(producer, sessionId, `Completed ${block.name}: ${JSON.stringify(result)}`)
    return this.toToolResult(block.id, result)
  }

  /** 프로젝트 최근 지식을 도구 입력의 context.domainKnowledge로 주입한다(repo·projectId 없으면 원본 반환). */
  private async injectDomainKnowledge(rawInput: unknown, userContext?: UserContext): Promise<unknown> {
    if (!this.knowledgeRepo || !userContext?.projectId) return rawInput
    try {
      const entries = await this.knowledgeRepo.recentByProject(userContext.projectId, WIKI_INJECT_LIMIT)
      if (entries.length === 0) return rawInput
      const obj = (typeof rawInput === 'object' && rawInput !== null) ? rawInput as Record<string, unknown> : {}
      const ctx = (typeof obj['context'] === 'object' && obj['context'] !== null) ? obj['context'] as Record<string, unknown> : {}
      return { ...obj, context: { ...ctx, domainKnowledge: entries } }
    } catch (err) {
      console.warn('[runner] 위키 주입 실패 — 작업 계속:', err)
      return rawInput
    }
  }

  /** 게이트 통과한 결과의 knowledge[]를 프로젝트 위키에 저장한다(sourceAgent=도구명). 실제 저장 시 true. */
  private async storeDomainKnowledge(stage: string, result: unknown, userContext?: UserContext): Promise<boolean> {
    if (!this.knowledgeRepo || !userContext?.projectId) return false
    const raw = (typeof result === 'object' && result !== null) ? (result as Record<string, unknown>)['knowledge'] : undefined
    if (!Array.isArray(raw)) return false
    // knowledge 항목은 문자열(미분류) 또는 { content, category } 객체 모두 허용(하위호환)
    const entries = raw
      .map((k) => toKnowledgeEntry(k, stage))
      .filter((e): e is { content: string; sourceAgent: string; category?: string } => e !== null)
    if (entries.length === 0) return false
    try {
      await this.knowledgeRepo.insertMany(userContext.projectId, entries)
      return true
    } catch (err) {
      console.warn('[runner] 위키 저장 실패 — 작업 계속:', err)
      return false
    }
  }

  /**
   * PO가 게이트 승인 시 '위키에 저장'을 선택하면 승인된 결정 요약을 위키에 누적한다.
   * 지식성 단계(plan_task·design_ui·develop_code·security_audit)에서만 저장하며,
   * repo·projectId 없으면 skip하고 저장 실패해도 승인 흐름을 차단하지 않는다.
   */
  private async saveApprovedDecision(stage: string, summary: string, userContext?: UserContext): Promise<boolean> {
    if (!this.knowledgeRepo || !userContext?.projectId || !isKnowledgeBearingStage(stage)) return false
    try {
      await this.knowledgeRepo.insertMany(userContext.projectId, [
        // 승인자(userContext.userId)를 기록해 결정 provenance·audit를 남긴다
        { content: summary, sourceAgent: 'approval-gate', category: 'decision', ...(userContext.userId ? { approver: userContext.userId } : {}) },
      ])
      return true
    } catch (err) {
      console.warn('[runner] 승인 결정 위키 저장 실패 — 작업 계속:', err)
      return false
    }
  }

  /** tool_result 블록 생성 (4000자 상한). */
  private toToolResult(toolUseId: string, result: unknown): Anthropic.ToolResultBlockParam {
    const resultStr = JSON.stringify(result)
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: resultStr.length > 4000 ? resultStr.slice(0, 4000) + '...[truncated]' : resultStr,
    }
  }

  /**
   * 승인 게이트 루프. manual이면 info_request(approval) 발행 후 사용자 응답까지 대기.
   * approve → result 반환 / revise → 피드백으로 재실행 후 재게이트 / abort → GateAbortError.
   * 재실행은 MAX_GATE_REVISES회 상한(무한 루프 방지).
   */
  private async applyApprovalGate(
    handler: { execute: (i: unknown, s: string, u?: UserContext) => Promise<unknown> },
    block: Anthropic.ToolUseBlock,
    initialResult: unknown,
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
    userContext?: UserContext,
  ): Promise<unknown> {
    let result = initialResult
    let revises = 0
    for (;;) {
      if (effectiveMode(sessionStore.getGateConfig(sessionId), block.name) === 'auto') return result

      const summary = summarizeOutput(block.name, result)
      await producer.publish({
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'info_request',
        payload: {
          agentId: 'manager',
          content: `'${block.name}' 단계 결과를 검토하고 승인/수정/중단을 선택하세요.`,
          approval: { stage: block.name, summary, mode: 'manual' },
        },
      })
      const decision = parseDecision(await sessionStore.waitForInfo(sessionId))

      if (decision.kind === 'approve') {
        // '이 단계 앞으로 자동' 선택 시 이후 동일 단계는 게이트 없이 통과(배포는 항상 manual이라 무영향)
        if (decision.rememberAuto) sessionStore.setGateOverride(sessionId, block.name, 'auto')
        // PO가 '위키에 저장' 선택 시 승인된 결정 요약을 도메인 위키에 누적(지식성 단계 한정·비차단).
        // PO가 저장 전 요약을 편집했으면 그 내용(wikiSummary)을 우선, 없으면 자동 요약을 저장.
        if (decision.saveToWiki) {
          const saved = await this.saveApprovedDecision(block.name, decision.wikiSummary ?? summary, userContext)
          if (saved && userContext?.projectId) {
            await this.publishKnowledgeChanged(producer, sessionId, userContext.projectId)
          }
        }
        return result
      }
      if (decision.kind === 'abort') {
        sessionStore.abort(sessionId)
        throw new GateAbortError(block.name)
      }
      // revise
      if (++revises > MAX_GATE_REVISES) return result
      const augmented = { ...(block.input as Record<string, unknown>), clarificationContext: decision.feedback }
      result = await handler.execute(augmented, sessionId, userContext)
    }
  }

  /** 도구를 추가 context와 함께 재실행하고, 정상 경로와 동일한 후처리(게이트·위키 저장)를 거쳐 tool_result를 만든다. */
  private async reExecuteWithContext(
    block: Anthropic.ToolUseBlock,
    extraContext: Record<string, unknown>,
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
    userContext?: UserContext,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const handler = this.registry.get(block.name)
    if (!handler) throw new Error(`Unknown tool: ${block.name}`)
    try {
      const augmented = { ...(block.input as Record<string, unknown>), ...extraContext }
      const result = await handler.execute(augmented, sessionId, userContext)
      // 재실행 결과도 승인 게이트·위키 저장을 거친다(명확화/교차질의 산출물의 게이트 우회 방지)
      return await this.finalizeAgentResult(handler, block, result, sessionId, producer, sessionStore, userContext)
    } catch (retryErr) {
      if (retryErr instanceof GateAbortError) throw retryErr // 사용자 abort는 세션 종료로 전파(에러 결과로 변환 금지)
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Tool execution failed after re-execution: ${msg}`,
        is_error: true,
      }
    }
  }

  private async processToolUseBlocks(
    blocks: Anthropic.ContentBlock[],
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
    userContext?: UserContext,
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue
      if (block.name === 'request_info') {
        toolResults.push(await this.handleRequestInfoTool(block, sessionId, producer, sessionStore))
      } else {
        try {
          toolResults.push(await this.handleAgentTool(block, sessionId, producer, sessionStore, userContext))
        } catch (err) {
          if (err instanceof GateAbortError) throw err // 루프를 빠져나가 세션 종료
          if (err instanceof ClarificationNeededError) {
            // 하위 에이전트의 명확화 요청을 사용자에게 중계
            const basePayload = { agentId: 'manager', content: err.content }
            const infoRequestMsg: ManagerToOrchestratorMessage = {
              sessionId,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'info_request',
              payload: err.uiSpec !== undefined
                ? { ...basePayload, uiSpec: err.uiSpec as UISpec }
                : basePayload,
            }
            await producer.publish(infoRequestMsg)
            const answer = await sessionStore.waitForInfo(sessionId)
            // 명확화 응답을 포함하여 에이전트 재실행
            toolResults.push(
              await this.reExecuteWithContext(
                block, { clarificationContext: answer }, sessionId, producer, sessionStore, userContext,
              ),
            )
          } else if (err instanceof AgentQueryError) {
            // 에이전트가 다른 에이전트에게 질의 → 대상 에이전트로 라우팅 후 응답으로 재실행
            const targetTool = resolveAgentTool(err.to)
            const targetHandler = targetTool ? this.registry.get(targetTool) : undefined
            if (!targetHandler) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Unknown query target agent: ${err.to}`,
                is_error: true,
              })
              continue
            }
            let queryAnswer: unknown
            try {
              queryAnswer = await targetHandler.execute(
                { query: err.question, queryKind: err.kind }, sessionId, userContext,
              )
            } catch (qErr) {
              const m = qErr instanceof Error ? qErr.message : String(qErr)
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Query to ${err.to} failed: ${m}`,
                is_error: true,
              })
              continue
            }
            toolResults.push(
              await this.reExecuteWithContext(
                block, { clarificationContext: JSON.stringify(queryAnswer) },
                sessionId, producer, sessionStore, userContext,
              ),
            )
          } else {
            const message = err instanceof Error ? err.message : String(err)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Tool execution failed: ${message}`,
              is_error: true,
            })
          }
        }
      }
    }
    return toolResults
  }

  async run(options: RunnerOptions): Promise<string> {
    const { sessionId, intent, context, producer, sessionStore, signal, userContext, gateMode } = options

    // 전역 게이트 모드(설정 UI) 적용 — 이 세션의 기본 승인 모드를 설정한다.
    // 단계별 override·배포 always-manual은 effectiveMode에서 그대로 우선하므로 영향 없음.
    if (gateMode) sessionStore.setGateDefaultMode(sessionId, gateMode)

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Task: ${intent}\n\nContext: ${JSON.stringify(context)}`,
      },
    ]

    const allRegistryTools = this.registry.toAnthropicTools()
    const tools: Anthropic.Tool[] = [
      // workspaceRoot가 이미 제공된 경우 register_project를 제외 — LLM이 불필요하게 호출하는 것을 방지
      ...(userContext?.workspaceRoot
        ? allRegistryTools.filter((t) => t.name !== 'register_project')
        : allRegistryTools),
      REQUEST_INFO_TOOL,
    ]

    let iterations = 0
    // 수동 tool-calling 루프: 각 도구 호출 전후에 status_update를 발행하기 위해 수동 루프 사용
    while (iterations++ < MAX_ITERATIONS) {
      if (signal?.aborted) throw new Error('Session aborted')

      let timerId: ReturnType<typeof setTimeout> | undefined
      let response: Anthropic.Message
      try {
        const timeoutSignal = new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new Error(`Claude API timed out after ${CLAUDE_CALL_TIMEOUT_MS}ms`)),
            CLAUDE_CALL_TIMEOUT_MS,
          )
        })
        const workspaceInstruction = userContext?.workspaceRoot
          ? `\nAlways use ${userContext.workspaceRoot} as the projectPath for ALL tool calls (develop_code, build_project, run_tests, etc.) — never use subdirectories. Keep projectPath consistent across all tool calls in a single task.`
          : ''
        response = await Promise.race([
          this.client.messages.create(
            {
              model: this.model,
              max_tokens: MAX_TOKENS,
              system: `You are xzawedManager, a project orchestration agent. Use the available tools to fulfill the task request. Keep your responses concise — always prefer calling a tool over writing lengthy analysis.${workspaceInstruction}`,
              messages,
              tools,
            },
            signal !== undefined ? { signal } : undefined,
          ),
          timeoutSignal,
        ])
      } finally {
        clearTimeout(timerId)
      }

      if (response.stop_reason === 'end_turn') {
        const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
        await producer.publish({
          sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'status_update',
          payload: { agentId: 'manager', content: text },
        })
        return text
      }

      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'tool_use') {
        const toolResults = await this.processToolUseBlocks(
          response.content, sessionId, producer, sessionStore, userContext,
        )
        if (toolResults.length === 0) {
          throw new Error('stop_reason was tool_use but no tool_use blocks found in response')
        }
        messages.push({ role: 'user', content: toolResults })
      } else {
        throw new Error(`Unexpected stop_reason: ${response.stop_reason as string}`)
      }
    }
    throw new Error(`Claude runner exceeded ${String(MAX_ITERATIONS)} iterations without completing`)
  }
}
