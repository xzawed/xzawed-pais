import { execFile } from 'node:child_process'
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

async function hasCommand(cmd: string): Promise<boolean> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    await execFileAsync(whichCmd, [cmd], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

function mapSeverity(s: string): SecurityIssue['severity'] {
  if (s === 'critical') return 'critical'
  if (s === 'high') return 'high'
  if (s === 'moderate') return 'medium'
  return 'low'
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

  const npmAvailable = await hasCommand('npm')
  if (!npmAvailable) {
    console.warn('[deps] npm not found — dependency audit skipped')
    return []
  }

  let stdout = ''
  try {
    const result = await execFileAsync(
      'npm',
      ['audit', '--json', '--audit-level=none'],
      { cwd: validPath, timeout: AUDIT_TIMEOUT_MS }
    )
    stdout = result.stdout
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'stdout' in e && typeof (e as { stdout: unknown }).stdout === 'string') {
      stdout = (e as { stdout: string }).stdout
    } else {
      return []
    }
  }

  let auditData: NpmAuditOutput
  try {
    auditData = JSON.parse(stdout) as NpmAuditOutput
  } catch {
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
