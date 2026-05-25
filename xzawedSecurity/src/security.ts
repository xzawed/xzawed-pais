import type { ManagerToSecurityMessage, SecurityIssue } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { analyzeFiles } from './analyzers/static.js'
import { auditDeps } from './analyzers/deps.js'
import type { Config } from './config.js'

export function resolveWorkspaceRoot(
  userContext: { workspaceRoot: string; [key: string]: unknown } | undefined,
  fallback: string | undefined,
): string {
  const resolved = userContext?.workspaceRoot || fallback || process.env.WORKSPACE_ROOT
  if (!resolved) {
    throw new Error('workspaceRoot를 결정할 수 없습니다')
  }
  return resolved
}

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'] as const

export function calculateScore(issues: SecurityIssue[]): number {
  const penalty = issues.reduce((acc, issue) => {
    if (issue.severity === 'critical') return acc + 40
    if (issue.severity === 'high') return acc + 15
    if (issue.severity === 'medium') return acc + 5
    return acc + 1
  }, 0)
  return Math.max(0, 100 - penalty)
}

export function filterBySeverity(
  issues: SecurityIssue[],
  minSeverity: 'low' | 'medium' | 'high',
): SecurityIssue[] {
  const minIdx = SEVERITY_ORDER.indexOf(minSeverity)
  return issues.filter((issue) => SEVERITY_ORDER.indexOf(issue.severity) >= minIdx)
}

export class Security {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config,
    private readonly staticAnalyzeFn: typeof analyzeFiles = analyzeFiles,
    private readonly depsAuditFn: typeof auditDeps = auditDeps,
  ) {}

  async handle(message: ManagerToSecurityMessage): Promise<void> {
    const { sessionId, payload } = message

    if (message.type === 'abort') return

    const base = {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)

    try {
      const [staticIssues, depsIssues, claudeIssues] = await Promise.all([
        this.staticAnalyzeFn(payload.artifacts, workspaceRoot).catch(
          () => [] as SecurityIssue[],
        ),
        this.depsAuditFn(payload.projectPath, workspaceRoot).catch(
          () => [] as SecurityIssue[],
        ),
        this.runner
          .analyzeArtifacts(payload.artifacts, workspaceRoot)
          .catch(() => [] as SecurityIssue[]),
      ])

      const allIssues = [...staticIssues, ...depsIssues, ...claudeIssues]
      const score = calculateScore(allIssues)
      const filtered = filterBySeverity(allIssues, payload.severity)

      const summary = `총 ${allIssues.length}개 이슈 중 ${filtered.length}개가 ${payload.severity} 이상 보고, 보안 점수: ${score}/100`

      await this.producer.publish(sessionId, {
        ...base,
        type: 'audit_complete',
        payload: {
          issues: filtered,
          score,
          summary,
          content: summary,
        },
      })
    } catch (err: unknown) {
      await this.producer.publish(sessionId, {
        ...base,
        type: 'error',
        payload: {
          content: err instanceof Error ? err.message : 'Unknown error',
        },
      })
    }
  }
}
