import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'
import type { Bulkhead } from '@xzawed/agent-streams'

interface SecurityAuditInput {
  artifacts: string[]
  severity: 'low' | 'medium' | 'high'
  projectPath: string
  context: Record<string, unknown>
}

// ⚠️ xzawedSecurity/src/types.ts의 SecurityIssue 미러(서비스 간 직접 import 금지·Redis 계약). 필드 추가 시 동기화. source는 P4 security 채널이 결정론 SAST findings 판별에 사용.
interface SecurityIssue {
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
 * 감사가 실제로 수행됐는지. **소비자는 lenient** — 모든 키가 optional이다.
 * 구버전 Security(필드 미발행)와 미래의 축 추가 양쪽에서 parse가 throw하지 않게 한다.
 */
interface SecurityAuditable {
  static?: {
    requested?: number
    scanned?: number
    skippedByReason?: {
      path?: number; stat?: number; oversize?: number; read?: number; analyzerError?: number
    }
  }
  deps?: {
    status?: 'ok' | 'unavailable' | 'not_applicable'
    tool?: 'npm' | 'pnpm' | null
    reason?: string
  }
}

interface SecurityAuditOutput {
  issues: SecurityIssue[]
  score: number
  summary: string
  content: string
  knowledge?: string[]
  auditable?: SecurityAuditable
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    artifacts: { type: 'array', items: { type: 'string' }, description: 'File paths to audit' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Minimum severity to report' },
    projectPath: { type: 'string', description: 'Path to the project root (use the workspaceRoot provided in the system prompt)' },
    context: { type: 'object', description: 'Additional context for the audit' },
  },
  required: ['artifacts', 'severity', 'projectPath', 'context'],
}

const securityIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  source: z.enum(['static', 'deps', 'llm']),
  category: z.string(),
  file: z.string(),
  line: z.number().optional(),
  description: z.string(),
  suggestion: z.string(),
  cwe: z.string().optional(),
})

const auditableSchema = z.object({
  static: z.object({
    requested: z.number().optional(),
    scanned: z.number().optional(),
    skippedByReason: z.object({
      path: z.number().optional(),
      stat: z.number().optional(),
      oversize: z.number().optional(),
      read: z.number().optional(),
      analyzerError: z.number().optional(),
    }).optional(),
  }).optional(),
  deps: z.object({
    status: z.enum(['ok', 'unavailable', 'not_applicable']).optional(),
    tool: z.enum(['npm', 'pnpm']).nullable().optional(),
    reason: z.string().optional(),
  }).optional(),
})

/**
 * ⚠️ **이 스키마가 계약의 실질적 병목이다.** `z.object`는 기본 strip이라 여기 없는 필드는
 * Redis 봉투에 실려 와도 런타임에 조용히 사라진다 — Security 쪽만 고치면 실효가 정확히 0이다.
 * 네 선언(에이전트 types.ts · 이 미러 interface · 이 스키마 · verify.ts 판정 스키마)을
 * 한 PR에 함께 착륙시킨다. 검사는 /contract-drift-check [4/4].
 */
/**
 * ⚠️ **`issues`·`score` 에 기본값을 주지 않는다**(S5.1 / 결함 D2).
 * `.default([])` · `.default(100)` 은 Security 가 침묵해도 **"0건·100점"을 합성해**
 * 감사했다는 증거 없이 만점을 보고했다 — 기본 경로(대화형 챗)의 약속 위반이다(L1-5).
 * 부재는 파싱 실패(=fail-closed)여야 한다. 생산자(`xzawedSecurity/src/security.ts:120-124`)는
 * 둘을 **항상** 싣는다 — 필수화의 정상 경로 회귀는 0이다.
 *
 * **`auditable` 은 optional 을 유지한다.** 이 스키마의 관용은 *전선 수준*(구버전 Security 의
 * 메시지를 통째로 거부하지 않는다)이고, "증거 없이 통과 금지"는 *판정 수준*이다 —
 * 다른 층이다. 부재는 `verify.ts` 의 `judgeAuditable` 이 fail-closed 로 막는다.
 *
 * `summary`·`content` 는 표시용이라 기본값을 유지한다(판정 입력이 아니다).
 */
export const outputSchema = z.object({
  issues: z.array(securityIssueSchema),
  score: z.number(),
  summary: z.string().default(''),
  content: z.string().default(''),
  knowledge: z.array(z.string()).optional(),
  auditable: auditableSchema.optional(),
})

export function createSecurityAuditHandler(redisUrl: string, bulkhead?: Bulkhead): ToolHandler<SecurityAuditInput, SecurityAuditOutput> {
  return new RedisAgentHandler<SecurityAuditInput, SecurityAuditOutput>(
    redisUrl,
    'security',
    'audit_request',
    'audit_complete',
    'security_audit',
    'Audit code artifacts for security vulnerabilities above the specified severity',
    inputSchema,
    outputSchema as z.ZodType<SecurityAuditOutput>,
    undefined,
    bulkhead,
  )
}
