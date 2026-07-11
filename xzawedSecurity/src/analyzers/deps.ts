import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SecurityIssue } from '../types.js'
import { validatePath } from '../executor.js'

const execFileAsync = promisify(execFile)
const AUDIT_TIMEOUT_MS = 60_000

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

async function runNpmAudit(npmPath: string, validPath: string): Promise<SecurityIssue[]> {
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
      console.warn('[security] npm audit 실행 실패 — 취약점 미검출로 fail-open(감사 불능 ≠ 안전):', e)
      return []
    }
  }

  let auditData: NpmAuditOutput
  try {
    auditData = JSON.parse(stdout) as NpmAuditOutput
  } catch {
    console.warn('[security] npm audit 출력 JSON 파싱 실패 — 취약점 미검출로 fail-open')
    return []
  }

  return Object.entries(auditData.vulnerabilities ?? {}).map(([pkgName, vuln]) => {
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
}

async function runPnpmAudit(pnpmPath: string, validPath: string): Promise<SecurityIssue[]> {
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
      console.warn('[security] pnpm audit 실행 실패 — 취약점 미검출로 fail-open(감사 불능 ≠ 안전):', e)
      return []
    }
  }

  let auditData: PnpmAuditOutput
  try {
    auditData = JSON.parse(stdout) as PnpmAuditOutput
  } catch {
    console.warn('[security] pnpm audit 출력 JSON 파싱 실패 — 취약점 미검출로 fail-open')
    return []
  }

  return Object.entries(auditData.advisories ?? {}).map(([id, adv]) => {
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
}

export async function auditDeps(
  projectPath: string,
  workspaceRoot: string,
): Promise<SecurityIssue[]> {
  const validPath = await validatePath(projectPath, workspaceRoot)

  try {
    await fs.access(path.join(validPath, 'package.json'))
  } catch {
    return []
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
    return []
  }

  return runNpmAudit(npmPath, validPath)
}
