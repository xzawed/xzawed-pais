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
    if (type === 'claude-code') {
      spawnSync('npx', ['skills', 'add', packageName], { stdio: 'inherit' })
    } else {
      const xzawedDir = xzawedPluginsDir()
      if (!existsSync(xzawedDir)) mkdirSync(xzawedDir, { recursive: true })
      spawnSync('npm', ['install', packageName, '--prefix', xzawedDir], { stdio: 'inherit' })
    }
  }

  async toggle(id: string): Promise<void> {
    const disabled = loadDisabled()
    if (disabled.has(id)) disabled.delete(id)
    else disabled.add(id)
    saveDisabled(disabled)
  }

  async uninstall(id: string): Promise<void> {
    const xzawedDir = xzawedPluginsDir()
    spawnSync('npm', ['uninstall', id, '--prefix', xzawedDir], { stdio: 'ignore' })
    const disabled = loadDisabled()
    disabled.delete(id)
    saveDisabled(disabled)
  }
}
