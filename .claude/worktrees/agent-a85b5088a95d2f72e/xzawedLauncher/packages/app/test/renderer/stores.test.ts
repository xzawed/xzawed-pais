import { describe, it, expect, beforeEach } from 'vitest'
import { useServicesStore } from '../../src/renderer/src/stores/services.store.js'

describe('ServicesStore', () => {
  beforeEach(() => {
    useServicesStore.setState({ services: [], logs: [] })
  })

  it('appendLog adds line and caps at 200', () => {
    const { appendLog } = useServicesStore.getState()
    for (let i = 0; i < 210; i++) appendLog(`line ${i}`)
    expect(useServicesStore.getState().logs.length).toBe(200)
  })

  it('setServices updates services list', () => {
    useServicesStore.getState().setServices([{ name: 'redis', status: 'running' }])
    expect(useServicesStore.getState().services[0].status).toBe('running')
  })

  it('clearLogs empties log array', () => {
    useServicesStore.getState().appendLog('line')
    useServicesStore.getState().clearLogs()
    expect(useServicesStore.getState().logs).toHaveLength(0)
  })
})
