import { describe, it, expect, beforeEach } from 'vitest'
import { useIntegrationsStore } from '../../src/renderer/src/store/integrations.store.js'

describe('integrations.store', () => {
  beforeEach(() => {
    useIntegrationsStore.setState({
      github: { connected: false, username: null, avatarUrl: null, defaultRepo: null, repos: [] },
      mcp: { servers: [], statuses: {} },
      plugins: [],
      activePanel: 'chat',
      sidebarMode: 'auto',
    })
  })

  it('GitHub 연결 상태를 설정한다', () => {
    useIntegrationsStore.getState().setGitHubConnected('xzawed', 'https://avatar.url')
    const { github } = useIntegrationsStore.getState()
    expect(github.connected).toBe(true)
    expect(github.username).toBe('xzawed')
    expect(github.avatarUrl).toBe('https://avatar.url')
  })

  it('GitHub 연결을 해제한다', () => {
    useIntegrationsStore.getState().setGitHubConnected('xzawed', 'https://avatar.url')
    useIntegrationsStore.getState().setDefaultRepo('xzawed/my-app')
    useIntegrationsStore.getState().disconnectGitHub()
    const { github } = useIntegrationsStore.getState()
    expect(github.connected).toBe(false)
    expect(github.username).toBeNull()
    expect(github.defaultRepo).toBeNull()
  })

  it('MCP 서버 상태를 업데이트한다', () => {
    useIntegrationsStore.getState().setMcpStatus('context7', 'running')
    expect(useIntegrationsStore.getState().mcp.statuses['context7']).toBe('running')
  })

  it('플러그인 활성 상태를 토글한다', () => {
    useIntegrationsStore.setState({
      plugins: [{ id: 'p1', name: 'test', version: '1.0', description: '', type: 'claude-code', enabled: true }],
    })
    useIntegrationsStore.getState().togglePlugin('p1')
    expect(useIntegrationsStore.getState().plugins[0].enabled).toBe(false)
  })

  it('활성 패널을 전환한다', () => {
    useIntegrationsStore.getState().setActivePanel('github')
    expect(useIntegrationsStore.getState().activePanel).toBe('github')
  })
})
