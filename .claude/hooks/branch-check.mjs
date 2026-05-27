#!/usr/bin/env node
/**
 * PreToolUse Hook: git commit 시 브랜치 동기화 상태 확인
 * 비차단(exit 0) — 경고만 출력
 */
import { execSync } from 'node:child_process'

async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) process.exit(0)

  let data
  try { data = JSON.parse(raw) } catch { process.exit(0) }

  const command = data?.tool_input?.command ?? ''
  if (!command.includes('git commit')) process.exit(0)

  try {
    // origin/master가 얼마나 앞서 있는지 확인
    const aheadCount = execSync(
      'git rev-list --count HEAD..origin/master 2>/dev/null || echo 0',
      { encoding: 'utf8', timeout: 5000, shell: true },
    ).trim()

    const count = parseInt(aheadCount, 10)
    if (!Number.isNaN(count) && count >= 5) {
      console.log(`\n[branch-check] master가 ${count}개 커밋 앞서 있습니다.`)
      console.log('  충돌 예방을 위해 머지를 권장합니다:')
      console.log('  git fetch origin master && git merge origin/master\n')
    }
  } catch {
    // 오류는 무시 (오프라인, origin 없음 등)
  }

  process.exit(0) // 항상 비차단
}

main().catch(() => process.exit(0))
