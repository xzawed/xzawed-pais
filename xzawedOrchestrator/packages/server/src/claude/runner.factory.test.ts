import { describe, it, expect, vi } from 'vitest'
import { createRunner } from './runner.factory.js'
import { CLIRunner } from './cli-runner.js'
import { APIRunner } from './api-runner.js'
import { HTTPRemoteRunner } from './http-remote-runner.js'
import { SSHRemoteRunner } from './ssh-remote-runner.js'
import type { Config } from '../config.js'

vi.mock('./cli-runner.js', () => ({ CLIRunner: vi.fn() }))
vi.mock('./api-runner.js', () => ({ APIRunner: vi.fn() }))
vi.mock('./http-remote-runner.js', () => ({ HTTPRemoteRunner: vi.fn() }))
vi.mock('./ssh-remote-runner.js', () => ({ SSHRemoteRunner: vi.fn() }))

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3000,
    redisUrl: 'redis://localhost:6379',
    claudeMode: 'api',
    claudeModel: 'claude-sonnet-4-6',
    anthropicApiKey: 'test-key',
    managerUrl: 'http://localhost:3001',
    mode: 'local',
    auth: 'none',
    ...overrides,
  } as Config
}

describe('createRunner', () => {
  it('api 모드 — APIRunner 반환', () => {
    createRunner(makeConfig({ claudeMode: 'api' }))
    expect(APIRunner).toHaveBeenCalledWith({ apiKey: 'test-key', model: 'claude-sonnet-4-6' })
  })

  it('기본값(undefined claudeMode) — APIRunner 반환', () => {
    createRunner(makeConfig({ claudeMode: undefined as never }))
    expect(APIRunner).toHaveBeenCalled()
  })

  it('cli 모드 — CLIRunner 반환', () => {
    createRunner(makeConfig({ claudeMode: 'cli' }))
    expect(CLIRunner).toHaveBeenCalled()
  })

  it('remote 모드 + remoteCLIUrl — HTTPRemoteRunner 반환', () => {
    createRunner(makeConfig({ claudeMode: 'remote', remoteCLIUrl: 'http://remote:4000' }))
    expect(HTTPRemoteRunner).toHaveBeenCalledWith('http://remote:4000')
  })

  it('remote 모드 + SSH 설정 — SSHRemoteRunner 반환', () => {
    createRunner(makeConfig({
      claudeMode: 'remote',
      remoteCLIUrl: undefined,
      remoteHost: 'host',
      remoteUser: 'user',
      remoteKeyPath: '/key',
    }))
    expect(SSHRemoteRunner).toHaveBeenCalledWith('host', 'user', '/key')
  })
})
