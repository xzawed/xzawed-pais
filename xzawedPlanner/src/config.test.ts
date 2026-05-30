import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

const base = { ANTHROPIC_API_KEY: 'sk-ant-test', WORKSPACE_ROOT: '/workspace' }

describe('loadConfig', () => {
  it('필수 변수 누락 시 ZodError를 던진다', () => {
    expect(() => loadConfig({})).toThrow()
  })

  it('유효한 환경변수로 Config를 반환한다', () => {
    const config = loadConfig(base)
    expect(config.anthropicApiKey).toBe('sk-ant-test')
    expect(config.workspaceRoot).toBe('/workspace')
    expect(config.port).toBe(3002)
    expect(config.claudeModel).toBe('claude-sonnet-4-6')
    expect(config.mode).toBe('local')
    expect(config.redisUrl).toBe('redis://localhost:6379')
  })

  it('PORT를 숫자로 파싱한다', () => {
    const config = loadConfig({ ...base, PORT: '4000' })
    expect(config.port).toBe(4000)
  })

  it('ANTHROPIC_API_KEY가 빈 문자열이면 오류를 던진다', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: '', WORKSPACE_ROOT: '/workspace' })).toThrow()
  })

  it('WORKSPACE_ROOT가 누락되면 오류를 던진다', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toThrow()
  })

  it('MODE가 유효하지 않으면 오류를 던진다', () => {
    expect(() => loadConfig({ ...base, MODE: 'invalid' })).toThrow()
  })
})
