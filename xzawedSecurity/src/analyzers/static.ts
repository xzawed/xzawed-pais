import fs from 'node:fs/promises'
import path from 'node:path'
import type { SecurityIssue } from '../types.js'
import { validatePath } from '../executor.js'
import { CRYPTO_RULES } from './static-crypto.js'
import { CONFIG_RULES } from './static-config.js'
import { INJECTION_RULES } from './static-injection.js'
import { TRAVERSAL_RULES } from './static-traversal.js'
import { XSS_RULES } from './static-xss.js'
import { ACCESS_RULES } from './static-access.js'

const MAX_FILE_SIZE_BYTES = 1_048_576 // 1 MB

export interface StaticRule {
  id: string
  pattern: RegExp
  severity: SecurityIssue['severity']
  category: string
  description: string
  suggestion: string
  cwe?: string
}

const RULES: StaticRule[] = [
  {
    id: 'S001',
    pattern: /password\s*[:=]\s*['"`][^'"`]{1,}/gi,
    severity: 'critical',
    category: 'exposure',
    description: '하드코딩된 패스워드',
    suggestion: '환경변수 또는 시크릿 관리자를 사용하세요',
    cwe: 'CWE-798',
  },
  {
    id: 'S002',
    pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g,
    severity: 'critical',
    category: 'exposure',
    description: 'Anthropic API 키 노출',
    suggestion: '환경변수(ANTHROPIC_API_KEY)로 이동하세요',
    cwe: 'CWE-312',
  },
  {
    id: 'S003',
    pattern: /\beval\s*\(/g,
    severity: 'high',
    category: 'injection',
    description: 'eval() 사용 — 코드 인젝션 위험',
    suggestion: 'JSON.parse 또는 안전한 대안을 사용하세요',
    cwe: 'CWE-94',
  },
  {
    id: 'S004',
    pattern: /innerHTML\s*=/g,
    severity: 'high',
    category: 'xss',
    description: 'innerHTML 직접 할당 — XSS 위험',
    suggestion: 'textContent 또는 DOMPurify를 사용하세요',
    cwe: 'CWE-79',
  },
  {
    id: 'S005',
    pattern: /\.query\s*\(\s*(`[^`]*\$\{|['"][^'"]*'\s*\+|["'][^"']*"\s*\+)/g,
    severity: 'high',
    category: 'injection',
    description: '문자열 연결 SQL 쿼리 — SQL 인젝션 위험',
    suggestion: 'Prepared statement를 사용하세요',
    cwe: 'CWE-89',
  },
]

const ALL_RULES: StaticRule[] = [
  ...RULES,
  ...CRYPTO_RULES,
  ...CONFIG_RULES,
  ...INJECTION_RULES,
  ...TRAVERSAL_RULES,
  ...XSS_RULES,
  ...ACCESS_RULES,
]

const CONCURRENCY_LIMIT = 5

/**
 * 파일 단위 skip 사유별 카운트.
 *
 * `analyzerError`는 이 모듈이 채우지 않는다 — 분석기 전체가 rejected된 상태를 상위
 * (`security.ts`)가 표현할 때 쓰는 자리다.
 */
export interface StaticSkipReasons {
  path: number       // validatePath 거부 — 배포 구성 오류 신호
  stat: number       // fs.stat 실패
  oversize: number   // 크기 상한 초과 — 정책상 부분 미검사(실패 아님)
  read: number       // fs.readFile 실패
  analyzerError: number
}

/**
 * 스캔 결과와 **얼마나 실제로 검사했는지**.
 *
 * 이슈 배열만으로는 "취약점이 없다"와 "한 건도 못 읽었다"가 구분되지 않는다. 그 구분이
 * 없던 탓에 경로 결합 결함이 "0건"으로 위장돼 Manager 검증 채널까지 통과했다.
 *
 * 불변식: `requested === scanned + path + stat + oversize + read + analyzerError`
 */
export interface StaticScanStats {
  issues: SecurityIssue[]
  requested: number
  scanned: number
  skippedByReason: StaticSkipReasons
}

type FileOutcome = 'scanned' | keyof StaticSkipReasons

export async function analyzeFilesWithStats(
  filePaths: string[],
  workspaceRoot: string,
): Promise<StaticScanStats> {
  const issues: SecurityIssue[] = []
  const skippedByReason: StaticSkipReasons = { path: 0, stat: 0, oversize: 0, read: 0, analyzerError: 0 }
  let scanned = 0

  for (let i = 0; i < filePaths.length; i += CONCURRENCY_LIMIT) {
    const batch = filePaths.slice(i, i + CONCURRENCY_LIMIT)
    const batchResults = await Promise.all(batch.map((fp) => analyzeFile(fp, workspaceRoot)))
    for (const r of batchResults) {
      if (r.outcome === 'scanned') {
        scanned++
        issues.push(...r.issues)
      } else {
        skippedByReason[r.outcome]++
      }
    }
  }

  return { issues, requested: filePaths.length, scanned, skippedByReason }
}

/** 기존 계약 유지 — 규칙 테스트 다수가 이 형태를 쓴다. 프로덕션 진입점은 analyzeFilesWithStats다. */
export async function analyzeFiles(
  filePaths: string[],
  workspaceRoot: string,
): Promise<SecurityIssue[]> {
  return (await analyzeFilesWithStats(filePaths, workspaceRoot)).issues
}

async function analyzeFile(
  filePath: string,
  workspaceRoot: string,
): Promise<{ issues: SecurityIssue[]; outcome: FileOutcome }> {
  let validPath: string
  try {
    validPath = await validatePath(filePath, workspaceRoot)
  } catch (err) {
    // 무음 금지 — "감사 대상을 못 읽었다"와 "취약점이 없다"는 다른 사실이다.
    // 이 catch가 조용했던 탓에 경로 결합 결함이 "이슈 0건"으로 위장돼 있었다.
    console.warn(`[static] 경로 거부 — 감사 건너뜀: ${filePath}`, err)
    return { issues: [], outcome: 'path' }
  }

  try {
    const stat = await fs.stat(validPath)
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.warn(`[static] skipping oversized file (${stat.size} bytes): ${validPath}`)
      return { issues: [], outcome: 'oversize' }
    }
  } catch (err) {
    console.warn(`[static] stat 실패 — 감사 건너뜀: ${filePath}`, err)
    return { issues: [], outcome: 'stat' }
  }

  let content: string
  try {
    content = await fs.readFile(validPath, 'utf-8')
  } catch (err) {
    console.warn(`[static] 읽기 실패 — 감사 건너뜀: ${filePath}`, err)
    return { issues: [], outcome: 'read' }
  }

  return { issues: scanLines(content.split('\n'), filePath), outcome: 'scanned' }
}

function scanLines(lines: string[], filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  for (const rule of ALL_RULES) {
    for (let i = 0; i < lines.length; i++) {
      rule.pattern.lastIndex = 0
      const line = lines[i]
      if (line !== undefined && rule.pattern.test(line)) {
        issues.push(buildIssue(rule, filePath, i + 1))
      }
    }
  }
  return issues
}

function buildIssue(rule: StaticRule, filePath: string, lineNumber: number): SecurityIssue {
  const issue: SecurityIssue = {
    id: `${rule.id}-${path.basename(filePath)}-${lineNumber}`,
    severity: rule.severity,
    source: 'static',
    category: rule.category,
    file: filePath,
    line: lineNumber,
    description: rule.description,
    suggestion: rule.suggestion,
  }
  if (rule.cwe !== undefined) issue.cwe = rule.cwe
  return issue
}
