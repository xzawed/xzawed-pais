#!/usr/bin/env node
/**
 * PostToolUse Hook: Edit/Write/MultiEdit 후 해당 서비스 테스트 자동 실행
 * 비차단(exit 0 고정) — 실패해도 Claude 작업 계속
 */
import { execSync } from 'node:child_process'

const SKIP_PATTERNS = [
  /\.md$/i, /\.yml$/i, /\.yaml$/i, /\.json$/i, /\.env/,
  /[/\\]dist[/\\]/, /[/\\]node_modules[/\\]/, /[/\\]\.turbo[/\\]/,
  /[/\\]coverage[/\\]/, /[/\\]build[/\\]/, /[/\\]out[/\\]/,
]

const SERVICE_MAP = [
  { pattern: /xzawedOrchestrator[/\\]packages[/\\]server/, cmd: 'cd xzawedOrchestrator/packages/server && pnpm test' },
  { pattern: /xzawedOrchestrator[/\\]packages[/\\]ui/,     cmd: 'cd xzawedOrchestrator/packages/ui && pnpm test' },
  { pattern: /xzawedOrchestrator[/\\]packages[/\\]app/,    cmd: 'cd xzawedOrchestrator/packages/app && pnpm test' },
  { pattern: /xzawedManager[/\\]packages[/\\]server/,      cmd: 'cd xzawedManager/packages/server && pnpm test' },
  { pattern: /xzawedShared[/\\]/,    cmd: 'cd xzawedShared && pnpm build && pnpm test' },
  { pattern: /xzawedPlanner[/\\]/,   cmd: 'cd xzawedPlanner && pnpm test' },
  { pattern: /xzawedDeveloper[/\\]/, cmd: 'cd xzawedDeveloper && pnpm test' },
  { pattern: /xzawedDesigner[/\\]/,  cmd: 'cd xzawedDesigner && pnpm test' },
  { pattern: /xzawedTester[/\\]/,    cmd: 'cd xzawedTester && pnpm test' },
  { pattern: /xzawedBuilder[/\\]/,   cmd: 'cd xzawedBuilder && pnpm test' },
  { pattern: /xzawedWatcher[/\\]/,   cmd: 'cd xzawedWatcher && pnpm test' },
  { pattern: /xzawedSecurity[/\\]/,  cmd: 'cd xzawedSecurity && pnpm test' },
]

async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) process.exit(0)

  let data
  try { data = JSON.parse(raw) } catch { process.exit(0) }

  const filePath = (data?.tool_input?.file_path ?? '').replace(/\\/g, '/')
  if (!filePath) process.exit(0)

  if (SKIP_PATTERNS.some(p => p.test(filePath))) process.exit(0)

  const match = SERVICE_MAP.find(({ pattern }) => pattern.test(filePath))
  if (!match) process.exit(0)

  let repoRoot
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch { process.exit(0) }

  const serviceName = match.cmd.split(' && ')[0].replace('cd ', '')
  console.log(`\n🧪 [post-edit] ${serviceName} 테스트 실행 중...`)

  try {
    const output = execSync(match.cmd, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    const lines = output.split('\n')
    console.log(lines.slice(-30).join('\n'))
  } catch (err) {
    const output = String(err.stdout ?? '') + String(err.stderr ?? '')
    console.log(output.split('\n').slice(-30).join('\n'))
    console.log('\n⚠️  테스트 실패 — 확인 후 수정하세요 (작업은 계속됩니다)')
  }

  process.exit(0)  // 항상 비차단
}

main().catch(() => process.exit(0))
