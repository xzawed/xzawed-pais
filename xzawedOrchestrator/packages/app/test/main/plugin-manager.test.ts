import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}))
let disabledStore: string[] = []

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn((dir: string) => {
    if (dir.includes('claude-plugins-official')) return ['superpowers']
    if (dir.includes('cache')) return ['claude-plugins-official']
    return []
  }),
  readFileSync: vi.fn((filePath: string) => {
    if (String(filePath).includes('disabled-plugins')) return JSON.stringify(disabledStore)
    return JSON.stringify({ name: 'superpowers', version: '5.1.0', description: 'Skills and workflows' })
  }),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    if (String(filePath).includes('disabled-plugins')) disabledStore = JSON.parse(data) as string[]
  }),
  mkdirSync: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }))
vi.stubEnv('HOME', '/tmp/test-home')
vi.stubEnv('USERPROFILE', 'C:/Users/test')

import { PluginManager } from '../../src/main/plugin-manager.js'

describe('PluginManager', () => {
  let manager: PluginManager

  beforeEach(() => {
    disabledStore = []
    manager = new PluginManager()
  })

  it('Claude Code 플러그인 목록을 반환한다', async () => {
    const plugins = await manager.list()
    expect(plugins.some((p) => p.type === 'claude-code')).toBe(true)
  })

  it('플러그인을 비활성화했다가 다시 활성화한다', async () => {
    const before = await manager.list()
    const plugin = before.find((p) => p.id === 'superpowers')
    expect(plugin?.enabled).toBe(true)
    await manager.toggle('superpowers')
    const after = await manager.list()
    expect(after.find((p) => p.id === 'superpowers')?.enabled).toBe(false)
  })
})
