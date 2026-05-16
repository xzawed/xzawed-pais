import fs from 'node:fs/promises'
import path from 'node:path'

export async function detectBuildCommand(projectPath: string): Promise<string> {
  // 1. package.json 확인
  try {
    const content = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(content) as { scripts?: { build?: string } }
    return pkg.scripts?.build ?? 'pnpm run build'
  } catch {}

  // 2. Cargo.toml 확인
  try {
    await fs.access(path.join(projectPath, 'Cargo.toml'))
    return 'cargo build --release'
  } catch {}

  // 3. Makefile 확인
  try {
    await fs.access(path.join(projectPath, 'Makefile'))
    return 'make build'
  } catch {}

  throw new Error('빌드 명령을 감지할 수 없음')
}
