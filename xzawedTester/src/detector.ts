import fs from 'node:fs/promises'
import path from 'node:path'

export function buildCommandWithFiles(baseCmd: string, testFiles: string[]): string {
  if (testFiles.length === 0) return baseCmd
  return `${baseCmd} ${testFiles.join(' ')}`
}

export async function detectTestCommand(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }

    // scripts.test가 실제 명령인 경우 (echo no test 같은 경우 제외)
    if (pkg.scripts?.['test'] && !pkg.scripts['test'].startsWith('echo')) {
      return pkg.scripts['test']
    }

    // devDependencies로 프레임워크 감지
    const allDeps = { ...pkg.devDependencies, ...pkg.dependencies }
    if ('vitest' in allDeps) return 'pnpm vitest run'
    if ('jest' in allDeps) return 'pnpm jest'
    if ('mocha' in allDeps) return 'pnpm mocha'

    return 'pnpm test'
  } catch {}

  // Cargo.toml — Rust
  try {
    await fs.access(path.join(projectPath, 'Cargo.toml'))
    return 'cargo test'
  } catch {}

  // Makefile
  try {
    await fs.access(path.join(projectPath, 'Makefile'))
    return 'make test'
  } catch {}

  // Python
  try {
    await fs.access(path.join(projectPath, 'pyproject.toml'))
    return 'pytest'
  } catch {}

  throw new Error('테스트 명령을 감지할 수 없습니다')
}

export function parseTestCounts(output: string): { passed: number; failed: number } {
  let passed = 0
  let failed = 0

  // Vitest: "42 passed" / "3 failed"
  const vitestPassed = output.match(/(\d+)\s+passed/)
  const vitestFailed = output.match(/(\d+)\s+failed/)
  if (vitestPassed) passed = parseInt(vitestPassed[1] ?? '0', 10)
  if (vitestFailed) failed = parseInt(vitestFailed[1] ?? '0', 10)

  // Jest: "Tests: 3 failed, 42 passed"
  if (passed === 0 && failed === 0) {
    const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(\d+)\s+passed/)
    if (jestMatch) {
      failed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0
      passed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0
    }
  }

  // cargo test: "42 passed; 3 failed"
  if (passed === 0 && failed === 0) {
    const cargoMatch = output.match(/(\d+)\s+passed;\s*(\d+)\s+failed/)
    if (cargoMatch) {
      passed = parseInt(cargoMatch[1] ?? '0', 10)
      failed = parseInt(cargoMatch[2] ?? '0', 10)
    }
  }

  return { passed, failed }
}
