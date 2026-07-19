import type { WorkPackage, BudgetCircuitBreaker, ProviderCircuitBreaker } from '@xzawed/agent-streams'
import { runStage, buildStageCircuit, type StageDeps, type StageSpec } from '../decompose/stages/run-stage.js'
import {
  AdvisoryFindingsResultSchema, MAX_ADVISORY_FINDINGS,
  type AdvisoryFinding, type AdvisoryFindingsResult,
} from '../db/advisory.types.js'

/** advisory 영속 포트(AdvisoryRepo가 구조적 만족). 워커가 주입. */
export interface AdvisoryStore {
  recordFindings(workflowId: string, wpId: string, attempt: number, findings: AdvisoryFinding[], tenantId: string | null): Promise<void>
}

/** produceAdvisory 의존: LLM seam(StageDeps=claude/model/timeoutMs) + 영속 포트. */
export interface AdvisoryProducerDeps extends StageDeps {
  advisoryStore: AdvisoryStore
  /** G11 Slice 4: 테넌트 태그(워커 userContext 유래). 부재는 정상(null). */
  tenantId: string | null
  /** G1: §13 서킷(러너·decompose와 동일 인스턴스). 미주입이면 무보호(회귀 0). */
  budget?: BudgetCircuitBreaker
  provider?: ProviderCircuitBreaker
  isProviderFailure?: (err: unknown) => boolean
}

const ADVISORY_SYSTEM =
  '너는 코드 산출물의 optimization 검토자다. 산출물을 수정하지 말고, 더 효율적/나은 방식을 ' +
  '비용·효과와 함께 순위로 제안만 한다. 반드시 JSON 객체 {"findings":[{"title":...,"rationale":...}]}만 출력한다.'

/** WP 계약 + 완료 산출물 요약을 사용자 프롬프트로(얕은 수준 — 깊은 내용 리뷰는 후속). */
function buildAdvisoryUser(wp: WorkPackage, artifactSummary: string): string {
  const ac = wp.acceptanceCriteria.map((a) => `- ${a}`).join('\n')
  return `Story ${wp.storyId} (role ${wp.owningRole}).\nAcceptance criteria:\n${ac}\n\nArtifacts:\n${artifactSummary}\n\n위 산출물에 대한 optimization 제안을 JSON으로.`
}

function summarizeArtifacts(result: unknown): string {
  const raw = result && typeof result === 'object' && 'artifacts' in result
    ? (result as { artifacts: unknown }).artifacts
    : undefined
  const arr = Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : []
  return arr.length > 0 ? arr.join('\n') : '(산출물 목록 없음)'
}

/**
 * P4 advisory(optimization 렌즈) 최소 생산자. **best-effort never-throw** — 게이트(verifyWp)가 verdict.ok를
 * 낸 뒤 호출되며, 어떤 실패(LLM throw·파싱 실패·DB throw)도 삼켜 완료 결정에 영향 0(N3). findings 비면 no-op.
 * advisory는 비차단·정보성이라 LLM 판정 허용(N1/N6는 차단 게이트만 구속, spec §9).
 */
export async function produceAdvisory(
  workflowId: string, wp: WorkPackage, attempt: number, result: unknown, deps: AdvisoryProducerDeps,
): Promise<void> {
  try {
    const circuit = buildStageCircuit(workflowId, {
      ...(deps.budget && { budget: deps.budget }),
      ...(deps.provider && { provider: deps.provider }),
      ...(deps.isProviderFailure && { isProviderFailure: deps.isProviderFailure }),
    })
    const stageDeps: StageDeps = { claude: deps.claude, model: deps.model, timeoutMs: deps.timeoutMs, ...(circuit && { circuit }) }
    const spec: StageSpec<AdvisoryFindingsResult> = {
      system: ADVISORY_SYSTEM,
      user: buildAdvisoryUser(wp, summarizeArtifacts(result)),
      maxTokens: 1024,
      schema: AdvisoryFindingsResultSchema,
      fallback: () => ({ findings: [] }),
    }
    const out = await runStage(stageDeps, spec)
    const findings: AdvisoryFinding[] = out.findings
      .slice(0, MAX_ADVISORY_FINDINGS)
      .map((finding, i) => ({
        rank: i + 1, title: finding.title, rationale: finding.rationale,
        severity: 'advisory' as const, sourceLens: 'optimization' as const,
      }))
    if (findings.length === 0) return
    await deps.advisoryStore.recordFindings(workflowId, wp.id, attempt, findings, deps.tenantId)
  } catch (err) {
    // best-effort: advisory 실패는 완료/게이트에 영향 0(N3). 관측 로그만.
    console.warn('[advisory] 생산 실패(best-effort·게이트 무관):', err)
  }
}
