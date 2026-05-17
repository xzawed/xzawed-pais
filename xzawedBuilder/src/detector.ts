import fs from 'node:fs/promises'
import path from 'node:path'

export async function detectBuildCommand(projectPath: string): Promise<string> {
  // 1. Cargo.toml 확인 (Rust)
  const hasCargoToml = await fs.access(path.join(projectPath, 'Cargo.toml')).then(() => true).catch(() => false)
  if (hasCargoToml) return 'cargo build --release'

  // 2. Makefile 확인
  const hasMakefile = await fs.access(path.join(projectPath, 'Makefile')).then(() => true).catch(() => false)
  if (hasMakefile) return 'make build'

  // 3. package.json 확인 — scripts.build 는 신뢰하지 않고, 의존성으로 빌드 도구를 판별
  const pkgPath = path.join(projectPath, 'package.json')
  const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false)
  if (hasPackageJson) {
    try {
      const content = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(content) as {
        devDependencies?: Record<string, string>
        dependencies?: Record<string, string>
      }
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      // 의존성 존재 여부로만 판별 — pkg.scripts.build 는 절대 사용하지 않는다
      if ('vite' in allDeps) return 'pnpm run build'
      if ('webpack' in allDeps) return 'pnpm run build'
      if ('tsc' in allDeps || 'typescript' in allDeps) return 'pnpm run build'
      return 'pnpm run build'
    } catch {
      return 'pnpm run build'
    }
  }

  // 4. go.mod 확인 (Go)
  const hasGoMod = await fs.access(path.join(projectPath, 'go.mod')).then(() => true).catch(() => false)
  if (hasGoMod) return 'go build ./...'

  throw new Error('빌드 명령을 감지할 수 없음')
}
