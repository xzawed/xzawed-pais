import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../../src/renderer/src/store/app.store.js'

describe('app.store', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { serverUrl: 'http://localhost:3000', mode: 'local', userId: 'user' },
      serverStatus: 'unknown',
      showSettings: false,
    })
  })

  it('starts with default settings', () => {
    const state = useAppStore.getState()
    expect(state.settings.serverUrl).toBe('http://localhost:3000')
    expect(state.settings.mode).toBe('local')
    expect(state.settings.userId).toBe('user')
    expect(state.serverStatus).toBe('unknown')
    expect(state.showSettings).toBe(false)
  })

  it('updateSettings merges partial settings', () => {
    useAppStore.getState().updateSettings({ serverUrl: 'http://remote:3000' })
    const state = useAppStore.getState()
    expect(state.settings.serverUrl).toBe('http://remote:3000')
    expect(state.settings.mode).toBe('local')
    expect(state.settings.userId).toBe('user')
  })

  it('updateSettings with mode change', () => {
    useAppStore.getState().updateSettings({ mode: 'remote', userId: 'alice' })
    const state = useAppStore.getState()
    expect(state.settings.mode).toBe('remote')
    expect(state.settings.userId).toBe('alice')
    expect(state.settings.serverUrl).toBe('http://localhost:3000')
  })

  it('setServerStatus transitions correctly', () => {
    useAppStore.getState().setServerStatus('running')
    expect(useAppStore.getState().serverStatus).toBe('running')

    useAppStore.getState().setServerStatus('stopped')
    expect(useAppStore.getState().serverStatus).toBe('stopped')

    useAppStore.getState().setServerStatus('unknown')
    expect(useAppStore.getState().serverStatus).toBe('unknown')
  })

  it('toggleSettings opens and closes the modal', () => {
    expect(useAppStore.getState().showSettings).toBe(false)

    useAppStore.getState().toggleSettings()
    expect(useAppStore.getState().showSettings).toBe(true)

    useAppStore.getState().toggleSettings()
    expect(useAppStore.getState().showSettings).toBe(false)
  })
})
