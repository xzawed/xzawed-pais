#!/usr/bin/env node
/**
 * PostToolUse Hook: 테스트 파일 저장 시 위험한 mock 패턴 감지
 * 비차단(exit 0) — 경고만 출력
 */
import { readFileSync } from 'node:fs'

const DANGEROUS_PATTERNS = [
  {
    pattern: /xreadgroup.*\.mockResolvedValue\s*\(\s*null\s*\)/,
    message: 'xreadgroup mock이 null을 즉시 resolve → macrotask 차단 → OOM 위험',
    fix: 'new Promise(r => setImmediate(() => r(null))) 사용',
  },
  {
    pattern: /xreadgroup.*\.mockResolvedValue\s*\(\s*\[\s*\]\s*\)/,
    message: 'xreadgroup mock이 빈 배열을 즉시 resolve → macrotask 차단 위험',
    fix: 'responses가 없을 때 setImmediate 패턴으로 대체',
  },
]

async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) process.exit(0)

  let data
  try { data = JSON.parse(raw) } catch { process.exit(0) }

  // PostToolUse: tool_name이 Edit/Write/MultiEdit인 경우만
  const toolName = data?.tool_name ?? ''
  if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) process.exit(0)

  const filePath = (data?.tool_input?.file_path ?? '').replace(/\\/g, '/')
  if (!filePath) process.exit(0)

  // 테스트 파일만 검사
  if (!filePath.includes('.test.') && !filePath.includes('.spec.')) process.exit(0)

  let content
  try {
    content = readFileSync(
      filePath.replace(/\//g, process.platform === 'win32' ? '\\' : '/'),
      'utf8',
    )
  } catch { process.exit(0) }

  const warnings = DANGEROUS_PATTERNS.filter(({ pattern }) => pattern.test(content))
  if (warnings.length === 0) process.exit(0)

  console.log('\n[mock-guard] 위험한 mock 패턴 감지:')
  for (const { message, fix } of warnings) {
    console.log(`  - ${message}`)
    console.log(`    수정: ${fix}`)
  }
  console.log('  참고: docs/development/testing-patterns.md\n')

  process.exit(0) // 항상 비차단
}

main().catch(() => process.exit(0))
