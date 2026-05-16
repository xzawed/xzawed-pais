import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('필수 변수 누락 시 ZodError를 던진다', () => {
    expect(() => loadConfig({})).toThrow()
  })

  it('유효한 환경변수로 Config를 반환한다', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      WORKSPACE_ROOT: '/workspace',
    })
    expect(config.anthropicApiKey).toBe('sk-ant-test')
    expect(config.workspaceRoot).toBe('/workspace')
    expect(config.port).toBe(3006)
    expect(config.buildTimeoutMs).toBe(120000)
    expect(config.claudeModel).toBe('claude-sonnet-4-6')
    expect(config.mode).toBe('local')
  })

  it('WORKSPACE_ROOT 누락 시 오류를 던진다', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toThrow()
  })

  it('PORT와 BUILD_TIMEOUT_MS를 숫자로 파싱한다', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      WORKSPACE_ROOT: '/workspace',
      PORT: '3007',
      BUILD_TIMEOUT_MS: '60000',
    })
    expect(config.port).toBe(3007)
    expect(config.buildTimeoutMs).toBe(60000)
  })
})
