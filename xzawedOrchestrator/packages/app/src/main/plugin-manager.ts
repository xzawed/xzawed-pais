import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  type: 'claude-code' | 'xzawed'
  enabled: boolean
}

const HOME = process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
const CLAUDE_PLUGINS_DIR = join(HOME, '.claude', 'plugins', 'cache')

// npm 패키지명 규칙: 선택적 @scope/ 접두사 + 이름 (경로 순회·셸 메타문자 차단)
const VALID_PKG_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[a-z0-9._~^*-]+)?$/i

function validatePackageName(name: string): void {
  if (!VALID_PKG_RE.test(name)) throw new Error(`Invalid package name: ${name}`)
}

function xzawedPluginsDir(): string {
  return join(app.getPath('userData'), 'xzawed-extensions')
}

function disabledPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'disabled-plugins.json')
}

function loadDisabled(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(disabledPath(), 'utf-8')) as string[])
  } catch { return new Set() }
}

function saveDisabled(disabled: Set<string>): void {
  writeFileSync(disabledPath(), JSON.stringify([...disabled], null, 2), 'utf-8')
}

function readPluginsFromDir(dir: string, type: 'claude-code' | 'xzawed', disabled: Set<string>): PluginInfo[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).flatMap((vendor) => {
      const vendorPath = join(dir, vendor)
      try {
        return readdirSync(vendorPath).map((name) => {
          const pkgPath = join(vendorPath, name, 'package.json')
          let version = '0.0.0', description = ''
          if (existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string; description?: string }
              version = pkg.version ?? '0.0.0'
              description = pkg.description ?? ''
            } catch { /* ignore */ }
          }
          return { id: name, name, version, description, type, enabled: !disabled.has(name) }
        })
      } catch { return [] }
    })
  } catch { return [] }
}

export class PluginManager {
  async list(): Promise<PluginInfo[]> {
    const disabled = loadDisabled()
    const claudeCode = readPluginsFromDir(CLAUDE_PLUGINS_DIR, 'claude-code', disabled)

    const xzawedDir = xzawedPluginsDir()
    const xzawed: PluginInfo[] = []
    if (existsSync(xzawedDir)) {
      try {
        readdirSync(xzawedDir).forEach((name) => {
          const pkgPath = join(xzawedDir, name, 'package.json')
          let version = '0.0.0', description = ''
          if (existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string; description?: string }
              version = pkg.version ?? '0.0.0'
              description = pkg.description ?? ''
            } catch { /* ignore */ }
          }
          xzawed.push({ id: name, name, version, description, type: 'xzawed', enabled: !disabled.has(name) })
        })
      } catch { /* ignore */ }
    }
    return [...claudeCode, ...xzawed]
  }

  async install(packageName: string, type: 'claude-code' | 'xzawed'): Promise<void> {
    validatePackageName(packageName)
    if (type === 'claude-code') {
      spawnSync('npx', ['skills', 'add', packageName], { stdio: 'inherit', shell: false }) // NOSONAR: command is hardcoded 'npx'; packageName validated by validatePackageName()
    } else {
      const xzawedDir = xzawedPluginsDir()
      if (!existsSync(xzawedDir)) mkdirSync(xzawedDir, { recursive: true })
      spawnSync('npm', ['install', packageName, '--prefix', xzawedDir], { stdio: 'inherit', shell: false }) // NOSONAR: command is hardcoded 'npm'; packageName validated by validatePackageName()
    }
  }

  async toggle(id: string): Promise<void> {
    const disabled = loadDisabled()
    if (disabled.has(id)) disabled.delete(id)
    else disabled.add(id)
    saveDisabled(disabled)
  }

  async uninstall(id: string): Promise<void> {
    validatePackageName(id)
    const xzawedDir = xzawedPluginsDir()
    spawnSync('npm', ['uninstall', id, '--prefix', xzawedDir], { stdio: 'ignore', shell: false }) // NOSONAR: command is hardcoded 'npm'; id validated by validatePackageName()
    const disabled = loadDisabled()
    disabled.delete(id)
    saveDisabled(disabled)
  }
}
