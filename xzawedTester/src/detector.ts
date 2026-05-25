import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const SHELL_METACHAR_RE = /[;&|`$><\n\r]/

const PkgSchema = z.object({
  dependencies: z.record(z.string()).optional(),
  devDependencies: z.record(z.string()).optional(),
})

export function buildCommandWithFiles(baseCmd: string, testFiles: string[]): string {
  if (testFiles.length === 0) return baseCmd
  for (const filePath of testFiles) {
    if (/[ \t]/.test(filePath)) {
      throw new Error(`Whitespace in testFiles path is not permitted: ${filePath}`)
    }
    if (SHELL_METACHAR_RE.test(filePath)) {
      throw new Error(`Shell metacharacters are not permitted in testFiles path: ${filePath}`)
    }
    if (path.isAbsolute(filePath) && path.parse(filePath).root === filePath) {
      throw new Error(`Filesystem root path is not permitted in testFiles: ${filePath}`)
    }
  }
  return `${baseCmd} ${testFiles.join(' ')}`
}

export async function detectTestCommand(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
    const pkgResult = PkgSchema.safeParse(JSON.parse(raw))
    if (pkgResult.success) {
      // Detect framework from dependencies and return a HARDCODED safe command.
      // Never trust scripts.test — it may contain arbitrary shell commands.
      const allDeps = { ...pkgResult.data.dependencies, ...pkgResult.data.devDependencies }
      if ('vitest' in allDeps) return 'pnpm vitest run'
      if ('jest' in allDeps) return 'pnpm jest'
      if ('mocha' in allDeps) return 'pnpm mocha'
      return 'pnpm test'
    }
  } catch {
    // Fallback for non-JS projects
  }

  // Cargo.toml — Rust
  const hasCargoToml = await fs.access(path.join(projectPath, 'Cargo.toml')).then(() => true).catch(() => false)
  if (hasCargoToml) return 'cargo test'

  throw new Error('테스트 명령을 감지할 수 없습니다')
}

export function parseTestCounts(output: string): { passed: number; failed: number } {
  let passed = 0
  let failed = 0

  // Jest: "Tests: 3 failed, 42 passed" — must match before generic pattern
  // because Jest also outputs "Test Suites: 1 passed" which generic regex matches first
  const jestMatch = output.match(/^Tests:\s+(?:(\d+)\s+failed,\s*)?(\d+)\s+passed/m)
  if (jestMatch) {
    return {
      failed: jestMatch[1] ? Number.parseInt(jestMatch[1], 10) : 0,
      passed: jestMatch[2] ? Number.parseInt(jestMatch[2], 10) : 0,
    }
  }

  // Vitest: "42 passed" / "3 failed"
  const vitestPassed = output.match(/(\d+)\s+passed/)
  const vitestFailed = output.match(/(\d+)\s+failed/)
  if (vitestPassed) passed = Number.parseInt(vitestPassed[1] ?? '0', 10)
  if (vitestFailed) failed = Number.parseInt(vitestFailed[1] ?? '0', 10)
  if (passed > 0 || failed > 0) return { passed, failed }

  // cargo test: "42 passed; 3 failed"
  const cargoMatch = output.match(/(\d+)\s+passed;\s*(\d+)\s+failed/)
  if (cargoMatch) {
    passed = Number.parseInt(cargoMatch[1] ?? '0', 10)
    failed = Number.parseInt(cargoMatch[2] ?? '0', 10)
  }

  return { passed, failed }
}
