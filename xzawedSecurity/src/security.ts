import type { ManagerToSecurityMessage, SecurityToManagerMessage, SecurityIssue, SecurityAuditable } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { analyzeFilesWithStats } from './analyzers/static.js'
import { auditDeps } from './analyzers/deps.js'
import type { Config } from './config.js'
import { resolveWorkspaceRoot, createCollaborativeHandler } from '@xzawed/agent-streams'

export { resolveWorkspaceRoot }

type SecurityPayload = ManagerToSecurityMessage['payload']

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
    private readonly staticAnalyzeFn: typeof analyzeFilesWithStats = analyzeFilesWithStats,
    private readonly depsAuditFn: typeof auditDeps = auditDeps,
  ) {}

  async handle(message: ManagerToSecurityMessage): Promise<void> {
    await createCollaborativeHandler<SecurityToManagerMessage, SecurityPayload>({
      publish: (sid, m) => this.producer.publish(sid, m),
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      completeType: 'audit_complete',
      runMain: async (payload, base) => {
        const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)

        const results = await Promise.allSettled([
          this.staticAnalyzeFn(payload.artifacts, workspaceRoot),
          this.depsAuditFn(payload.projectPath, workspaceRoot),
          this.runner.analyzeArtifacts(payload.artifacts, workspaceRoot),
        ])

        if (results.every((r) => r.status === 'rejected')) {
          throw new Error('모든 보안 분석기가 실패했습니다')
        }

        // rejected 를 무음으로 []로 강등하지 않는다 — 그것이 "감사 불능"을 "이슈 없음"으로 만든다.
        let staticStats
        if (results[0].status === 'fulfilled') {
          staticStats = results[0].value
        } else {
          console.warn('[security] static 분석기 rejected — 감사 불능으로 표기:', results[0].reason)
          staticStats = {
            issues: [] as SecurityIssue[],
            requested: payload.artifacts.length,
            scanned: 0,
            skippedByReason: { path: 0, stat: 0, oversize: 0, read: 0, analyzerError: payload.artifacts.length },
          }
        }

        let depsResult
        if (results[1].status === 'fulfilled') {
          depsResult = results[1].value
        } else {
          console.warn('[security] deps 분석기 rejected — 감사 불능으로 표기:', results[1].reason)
          depsResult = { issues: [] as SecurityIssue[], status: 'unavailable' as const, tool: null, reason: 'analyzer_error' }
        }

        const claudeResult = results[2].status === 'fulfilled' ? results[2].value : { issues: [] as SecurityIssue[] }

        const allIssues = [...staticStats.issues, ...depsResult.issues, ...claudeResult.issues]
        const score = calculateScore(allIssues)
        const filtered = filterBySeverity(allIssues, payload.severity)

        const auditable: SecurityAuditable = {
          static: {
            requested: staticStats.requested,
            scanned: staticStats.scanned,
            skippedByReason: staticStats.skippedByReason,
          },
          deps: {
            status: depsResult.status,
            tool: depsResult.tool,
            ...(depsResult.reason !== undefined ? { reason: depsResult.reason } : {}),
          },
        }

        // 감사 불능은 요약 문구에도 드러낸다. score 는 손대지 않는다 —
        // 그것을 숫자로 읽어 분기하는 코드가 저장소에 없어 바꿔봐야 신호가 되지 않고,
        // 오히려 "보안이 나쁨"으로 오독될 여지만 생긴다.
        const degraded: string[] = []
        if (auditable.static.requested > 0 && auditable.static.scanned === 0) {
          degraded.push(`static 미스캔(대상 ${auditable.static.requested}건 전부 건너뜀)`)
        }
        if (auditable.deps.status === 'unavailable') {
          degraded.push(`deps 감사 불능(${auditable.deps.reason ?? 'unknown'})`)
        }
        // not_applicable 은 실패가 아니라 비대상이므로 degraded 에 넣지 않는다.

        const measured = `총 ${allIssues.length}개 이슈 중 ${filtered.length}개가 ${payload.severity} 이상 보고, 보안 점수: ${score}/100`
        const summary = degraded.length === 0
          ? measured
          : `[감사 불능] ${degraded.join(' · ')} — 취약점 유무 판정 불가(감사 불능 ≠ 안전). ${measured}`
        const knowledge = claudeResult.knowledge

        return {
          publishResult: () => this.producer.publish(base.sessionId, {
            ...base,
            type: 'audit_complete',
            payload: { issues: filtered, score, summary, auditable, ...(knowledge ? { knowledge } : {}), content: summary },
          }),
        }
      },
    })(message)
  }
}
