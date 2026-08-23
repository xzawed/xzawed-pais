import path from 'node:path'
import { z } from 'zod'
import { collaborationPayloadFields } from '@xzawed/agent-streams'

export interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  source: 'static' | 'deps' | 'llm'
  category: string
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string
}

/**
 * **감사가 실제로 수행됐는지**를 나타내는 비트.
 *
 * `issues: []`만으로는 "취약점이 없다"와 "한 건도 감사하지 못했다"가 구분되지 않는다.
 * 그 구분이 없던 탓에 경로 결합 결함이 "0건"으로 위장돼 Manager 검증 채널에서
 * `security: passed` 증거로 영속됐다.
 *
 * LLM 축은 넣지 않는다 — 검증 채널이 결정론 findings(static·deps)만 게이트로 쓰고
 * LLM은 제외하므로(N6), LLM의 감사 가능 여부는 판정에 쓰이지 않는다.
 */
export interface SecurityAuditable {
  static: {
    requested: number
    scanned: number
    skippedByReason: {
      path: number
      stat: number
      oversize: number
      read: number
      analyzerError: number
    }
  }
  deps: {
    status: 'ok' | 'unavailable' | 'not_applicable'
    tool: 'npm' | 'pnpm' | null
    reason?: string
  }
}

export interface SecurityToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_complete' | 'error'
  payload: {
    issues?: SecurityIssue[]
    score?: number
    summary?: string
    knowledge?: string[]
    /** audit_complete 에서만 채워진다. error 메시지가 같은 payload 타입을 쓰므로 optional. */
    auditable?: SecurityAuditable
    content: string
  }
}

const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  githubRepo: z.object({ owner: z.string(), repo: z.string(), branch: z.string() }).optional(),
})

export const ManagerToSecurityMessageSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  timestamp: z.number(),
  type: z.enum(['audit_request', 'abort']),
  payload: z.object({
    artifacts: z.array(
      z.string().refine(
        (s) => !path.isAbsolute(s) && !s.includes('..'),
        { message: 'artifacts must be relative paths without path traversal' },
      ),
    ),
    projectPath: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    context: z.record(z.unknown()),
    userContext: UserContextSchema.optional(),
    ...collaborationPayloadFields,
  }),
})

export type ManagerToSecurityMessage = z.infer<typeof ManagerToSecurityMessageSchema>
