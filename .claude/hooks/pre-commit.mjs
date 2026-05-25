#!/usr/bin/env node
/**
 * PreToolUse Hook: git commit 시 품질 게이트 실행
 * 차단(exit 2) — 실패 시 Claude Code가 Bash 실행 취소
 * - 루트 package.json 없으면 빌드·감사 건너뜀 (서비스별 모노레포 구조)
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) process.exit(0)

  let data
  try { data = JSON.parse(raw) } catch { process.exit(0) }

  const command = data?.tool_input?.command ?? ''
  if (!command.includes('git commit')) process.exit(0)
  if (command.includes('--no-verify')) {
    console.log('⚠️  --no-verify 플래그로 품질 게이트 우회')
    process.exit(0)
  }

  let repoRoot
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch { process.exit(0) }

  const hasRootPackage = existsSync(join(repoRoot, 'package.json'))
  const stepCount = hasRootPackage ? 3 : 1

  console.log('\n🔍 커밋 전 품질 게이트 실행...\n')

  // 1. pnpm build (루트 package.json 있을 때만)
  if (hasRootPackage) {
    console.log(`📦 1/${stepCount} 빌드 확인 (타입 체크 포함)...`)
    try {
      execSync('pnpm build', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', timeout: 300_000 })
      console.log('  ✅ 빌드 통과\n')
    } catch (err) {
      const output = String(err.stdout ?? '') + String(err.stderr ?? '')
      console.log(output.split('\n').slice(-20).join('\n'))
      console.log('\n❌ 빌드 실패 — 커밋 차단')
      process.exit(2)
    }
  }

  // 2. jscpd (항상 실행)
  const cpdStep = hasRootPackage ? 2 : 1
  console.log(`🔁 ${cpdStep}/${stepCount} 중복 코드 확인 (jscpd)...`)
  try {
    execSync('npx jscpd@3.5.10 --config .jscpd.json', {
      cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', timeout: 120_000,
    })
    console.log('  ✅ CPD 통과\n')
  } catch (err) {
    const output = String(err.stdout ?? '') + String(err.stderr ?? '')
    console.log(output.split('\n').slice(-10).join('\n'))
    console.log('\n❌ CPD 실패 — 커밋 차단')
    process.exit(2)
  }

  // 3. pnpm audit (루트 package.json 있을 때만)
  if (hasRootPackage) {
    console.log(`🔒 3/${stepCount} 취약점 확인 (pnpm audit)...`)
    try {
      execSync('pnpm audit --audit-level=high', {
        cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', timeout: 60_000,
      })
      console.log('  ✅ 보안 감사 통과\n')
    } catch (err) {
      const output = String(err.stdout ?? '') + String(err.stderr ?? '')
      console.log(output.split('\n').slice(-15).join('\n'))
      console.log('\n❌ 고위험 취약점 발견 — 커밋 차단')
      process.exit(2)
    }
  }

  console.log('✅ 품질 게이트 통과 — 커밋 허용\n')
  process.exit(0)
}

main().catch(() => process.exit(0))
