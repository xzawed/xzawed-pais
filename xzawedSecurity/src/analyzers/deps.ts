import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SecurityIssue } from '../types.js'
import { validatePath } from '../executor.js'

const execFileAsync = promisify(execFile)
const AUDIT_TIMEOUT_MS = 60_000

/**
 * 의존성 감사의 **수행 여부**.
 *
 * - `ok`             감사가 실제로 돌았다(JSON 파싱 성공 ∧ 기대 키 존재). 이슈 0건이면 진짜 0건이다.
 * - `unavailable`    돌리지 못했다(도구 부재·실행 실패·출력 파싱 실패·경로 거부). **이슈 0건은 무의미하다.**
 * - `not_applicable` 감사 대상이 아니다(package.json 없음). 실패가 아니라 비대상이다.
 *
 * `unavailable`과 `not_applicable`을 가르는 이유 — 이 저장소 자신이 루트에 package.json이
 * 없어서, 둘을 하나로 접으면 매 감사가 "감사 불능"으로 표시된다.
 */
export type DepsAuditStatus = 'ok' | 'unavailable' | 'not_applicable'

export interface DepsAuditResult {
  issues: SecurityIssue[]
  status: DepsAuditStatus
  tool: 'npm' | 'pnpm' | null
  /** 분기 식별자. status가 'ok'면 생략한다. */
  reason?: string
}

interface NpmAuditVuln {
  severity: string
  via: Array<{ title?: string; cwe?: string[] } | string>
  fixAvailable: boolean | { name: string; version: string }
}

interface NpmAuditOutput {
  vulnerabilities?: Record<string, NpmAuditVuln>
}

interface PnpmAuditAdvisory {
  severity: string
  title?: string
  cwe?: string[]
  fixAvailable?: boolean
}

interface PnpmAuditOutput {
  advisories?: Record<string, PnpmAuditAdvisory>
}

function resolveBinPath(name: string): string | null {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const result = execFileSync(whichCmd, [name], { encoding: 'utf-8', timeout: 5_000 })
    const firstLine = result.trim().split(/\r?\n/)[0] ?? ''
    return firstLine.length > 0 ? firstLine : null
  } catch {
    return null
  }
}

let _npmPath: string | null | undefined = undefined
let _pnpmPath: string | null | undefined = undefined

function getNpmPath(): string | null {
  if (_npmPath !== undefined) return _npmPath
  _npmPath = resolveBinPath('npm')
  return _npmPath
}

function getPnpmPath(): string | null {
  if (_pnpmPath !== undefined) return _pnpmPath
  _pnpmPath = resolveBinPath('pnpm')
  return _pnpmPath
}

/** 테스트 또는 경로 변경 시 npm/pnpm 경로 캐시 초기화 */
export function resetPackageManagerPaths(): void {
  _npmPath = undefined
  _pnpmPath = undefined
}

function mapSeverity(s: string): SecurityIssue['severity'] {
  if (s === 'critical') return 'critical'
  if (s === 'high') return 'high'
  if (s === 'moderate') return 'medium'
  return 'low'
}

async function hasPnpmLock(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'pnpm-lock.yaml'))
    return true
  } catch {
    return false
  }
}

async function runNpmAudit(npmPath: string, validPath: string): Promise<DepsAuditResult> {
  let stdout = ''
  try {
    const result = await execFileAsync(
      npmPath,
      ['audit', '--json', '--audit-level=none'],
      { cwd: validPath, timeout: AUDIT_TIMEOUT_MS }
    )
    stdout = result.stdout
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'stdout' in e && typeof (e as { stdout: unknown }).stdout === 'string') {
      stdout = (e as { stdout: string }).stdout
    } else {
      // 감사 불능(도구 부재·네트워크·package.json 없음)을 빈 결과로 fail-open한다 —
      // '감사 불능'과 '취약점 없음'을 Manager가 구분 못 하므로 최소 로그로 관측 가능화.
      console.warn('[security] npm audit 실행 실패 — 감사 불능(감사 불능 ≠ 안전):', e)
      return { issues: [], status: 'unavailable', tool: 'npm', reason: 'npm_exec' }
    }
  }

  let auditData: NpmAuditOutput
  try {
    auditData = JSON.parse(stdout) as NpmAuditOutput
  } catch {
    console.warn('[security] npm audit 출력 JSON 파싱 실패 — 감사 불능')
    return { issues: [], status: 'unavailable', tool: 'npm', reason: 'npm_parse' }
  }

  // 기대 키 부재는 clean 결과가 아니다 — npm 11은 취약점이 없어도 "vulnerabilities": {} 를 낸다.
  if (auditData.vulnerabilities === undefined) {
    console.warn('[security] npm audit 출력에 vulnerabilities 키가 없음 — 감사 불능')
    return { issues: [], status: 'unavailable', tool: 'npm', reason: 'npm_no_expected_key' }
  }

  const issues = Object.entries(auditData.vulnerabilities).map(([pkgName, vuln]) => {
    const viaArr = Array.isArray(vuln.via) ? vuln.via : []
    const firstObj = viaArr.find((v): v is { title?: string; cwe?: string[] } => typeof v === 'object')
    const cwe = firstObj?.cwe?.[0]
    const fixAvail = typeof vuln.fixAvailable === 'boolean' ? vuln.fixAvailable : true

    const issue: SecurityIssue = {
      id: `DEP-${pkgName}`,
      severity: mapSeverity(vuln.severity),
      source: 'deps',
      category: 'dependency',
      file: path.join(validPath, 'package.json'),
      description: firstObj?.title ?? `취약한 의존성: ${pkgName}`,
      suggestion: fixAvail
        ? 'npm audit fix 또는 최신 버전으로 업그레이드하세요'
        : `${pkgName}의 안전한 대안을 검토하세요`,
    }
    if (cwe !== undefined) issue.cwe = cwe
    return issue
  })

  return { issues, status: 'ok', tool: 'npm' }
}

async function runPnpmAudit(pnpmPath: string, validPath: string): Promise<DepsAuditResult> {
  let stdout = ''
  try {
    const result = await execFileAsync(
      pnpmPath,
      ['audit', '--json'],
      { cwd: validPath, timeout: AUDIT_TIMEOUT_MS }
    )
    stdout = result.stdout
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'stdout' in e && typeof (e as { stdout: unknown }).stdout === 'string') {
      stdout = (e as { stdout: string }).stdout
    } else {
      console.warn('[security] pnpm audit 실행 실패 — 감사 불능(감사 불능 ≠ 안전):', e)
      return { issues: [], status: 'unavailable', tool: 'pnpm', reason: 'pnpm_exec' }
    }
  }

  let auditData: PnpmAuditOutput
  try {
    auditData = JSON.parse(stdout) as PnpmAuditOutput
  } catch {
    console.warn('[security] pnpm audit 출력 JSON 파싱 실패 — 감사 불능')
    return { issues: [], status: 'unavailable', tool: 'pnpm', reason: 'pnpm_parse' }
  }

  if (auditData.advisories === undefined) {
    console.warn('[security] pnpm audit 출력에 advisories 키가 없음 — 감사 불능')
    return { issues: [], status: 'unavailable', tool: 'pnpm', reason: 'pnpm_no_expected_key' }
  }

  const issues = Object.entries(auditData.advisories).map(([id, adv]) => {
    const issue: SecurityIssue = {
      id: `DEP-PNPM-${id}`,
      severity: mapSeverity(adv.severity),
      source: 'deps',
      category: 'dependency',
      file: path.join(validPath, 'package.json'),
      description: adv.title ?? '취약한 의존성 (pnpm audit)',
      suggestion: adv.fixAvailable ? 'pnpm update로 업그레이드하세요' : '안전한 대안을 검토하세요',
    }
    if (adv.cwe?.[0]) issue.cwe = adv.cwe[0]
    return issue
  })

  return { issues, status: 'ok', tool: 'pnpm' }
}

export async function auditDeps(
  projectPath: string,
  workspaceRoot: string,
): Promise<DepsAuditResult> {
  // validatePath 를 try 밖에 두면 이것만 reject되어 상위 allSettled가 무음으로 []를 만든다.
  let validPath: string
  try {
    validPath = await validatePath(projectPath, workspaceRoot)
  } catch (err) {
    console.warn('[deps] 경로 거부 — 의존성 감사 불능:', err)
    return { issues: [], status: 'unavailable', tool: null, reason: 'path' }
  }

  try {
    await fs.access(path.join(validPath, 'package.json'))
  } catch {
    // 실패가 아니라 **비대상**이다. 이 구분이 없으면 package.json 없는 프로젝트가
    // 매번 "감사 불능"으로 표시된다.
    return { issues: [], status: 'not_applicable', tool: null, reason: 'no_package_json' }
  }

  // pnpm-lock.yaml이 있으면 pnpm audit 우선
  if (await hasPnpmLock(validPath)) {
    const pnpmPath = getPnpmPath()
    if (pnpmPath !== null) {
      return runPnpmAudit(pnpmPath, validPath)
    }
    console.warn('[deps] pnpm not found — falling back to npm audit')
  }

  const npmPath = getNpmPath()
  if (npmPath === null) {
    console.warn('[deps] npm not found — dependency audit skipped')
    return { issues: [], status: 'unavailable', tool: null, reason: 'npm_not_found' }
  }

  return runNpmAudit(npmPath, validPath)
}
