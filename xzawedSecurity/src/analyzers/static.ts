import fs from 'node:fs/promises'
import path from 'node:path'
import type { SecurityIssue } from '../types.js'
import { validatePath } from '../executor.js'

const MAX_FILE_SIZE_BYTES = 1_048_576 // 1 MB

interface StaticRule {
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
    pattern: /\.query\s*\(\s*[`'"].*?\+/g,
    severity: 'high',
    category: 'injection',
    description: '문자열 연결 SQL 쿼리 — SQL 인젝션 위험',
    suggestion: 'Prepared statement를 사용하세요',
    cwe: 'CWE-89',
  },
]

const CONCURRENCY_LIMIT = 5

export async function analyzeFiles(
  filePaths: string[],
  workspaceRoot: string,
): Promise<SecurityIssue[]> {
  const results: SecurityIssue[][] = []
  for (let i = 0; i < filePaths.length; i += CONCURRENCY_LIMIT) {
    const batch = filePaths.slice(i, i + CONCURRENCY_LIMIT)
    const batchResults = await Promise.all(batch.map((fp) => analyzeFile(fp, workspaceRoot)))
    results.push(...batchResults)
  }
  return results.flat()
}

async function analyzeFile(filePath: string, workspaceRoot: string): Promise<SecurityIssue[]> {
  let validPath: string
  try {
    validPath = await validatePath(filePath, workspaceRoot)
  } catch {
    return []
  }

  try {
    const stat = await fs.stat(validPath)
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.warn(`[static] skipping oversized file (${stat.size} bytes): ${validPath}`)
      return []
    }
  } catch {
    return []
  }

  let content: string
  try {
    content = await fs.readFile(validPath, 'utf-8')
  } catch {
    return []
  }

  return scanLines(content.split('\n'), filePath)
}

function scanLines(lines: string[], filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  for (const rule of RULES) {
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
    category: rule.category,
    file: filePath,
    line: lineNumber,
    description: rule.description,
    suggestion: rule.suggestion,
  }
  if (rule.cwe !== undefined) issue.cwe = rule.cwe
  return issue
}
