import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}))
let disabledStore: string[] = []

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn((dir: string) => {
    if (String(dir).includes('claude-plugins-official')) return ['superpowers']
    if (String(dir).includes('cache')) return ['claude-plugins-official']
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
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } })) // NOSONAR
vi.stubEnv('HOME', '/tmp/test-home') // NOSONAR
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

  it('readdirSync가 . 와 .. 를 반환해도 필터링한다', async () => {
    vi.mocked(readdirSync).mockImplementationOnce(() => ['.', '..', 'claude-plugins-official'] as unknown as ReturnType<typeof readdirSync>)
    vi.mocked(readdirSync).mockImplementationOnce(() => ['.', '..', 'superpowers'] as unknown as ReturnType<typeof readdirSync>)
    const plugins = await manager.list()
    const ids = plugins.map((p) => p.id)
    expect(ids).not.toContain('.')
    expect(ids).not.toContain('..')
    expect(ids).toContain('superpowers')
  })

  it('install claude-code 타입 — npx skills add 실행', async () => {
    await manager.install('my-plugin', 'claude-code')
    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('npx', ['skills', 'add', 'my-plugin'], expect.objectContaining({ shell: false }))
  })

  it('install xzawed 타입 — npm install 실행', async () => {
    await manager.install('@my-scope/plugin', 'xzawed')
    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '@my-scope/plugin']), expect.objectContaining({ shell: false }))
  })

  it('유효하지 않은 패키지명으로 install하면 throw', async () => {
    await expect(manager.install('../evil/path', 'claude-code')).rejects.toThrow('Invalid package name')
  })

  it('uninstall — npm uninstall 실행 후 disabled 목록에서 제거', async () => {
    disabledStore = ['my-plugin']
    await manager.uninstall('my-plugin')
    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('npm', expect.arrayContaining(['uninstall', 'my-plugin']), expect.objectContaining({ shell: false }))
    expect(disabledStore).not.toContain('my-plugin')
  })

  it('유효하지 않은 패키지명으로 uninstall하면 throw', async () => {
    await expect(manager.uninstall('../evil')).rejects.toThrow('Invalid package name')
  })
})
