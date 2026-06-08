import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns parsed config when all required vars are set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.MODE = 'local'
    const config = loadConfig()
    expect(config.ANTHROPIC_API_KEY).toBe('sk-test-key')
    expect(config.PORT).toBe(3001)
    expect(config.CLAUDE_MODEL).toBe('claude-sonnet-4-6')
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.MODE = 'local'
    expect(() => loadConfig()).toThrow()
  })

  describe('MANAGER_GATE_FAILSAFE (fail-safe 기본값 계약)', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key'
      process.env.MODE = 'local'
    })
    it('미설정이면 기본 true (fail-safe 기본 보장 — 불확실=실패)', () => {
      delete process.env.MANAGER_GATE_FAILSAFE
      expect(loadConfig().MANAGER_GATE_FAILSAFE).toBe(true)
    })
    it("'false'면 레거시 fail-open 복원 (false)", () => {
      process.env.MANAGER_GATE_FAILSAFE = 'false'
      expect(loadConfig().MANAGER_GATE_FAILSAFE).toBe(false)
    })
    it("'false' 외 임의 문자열은 true ('true'·오타 모두 안전 기본으로 수렴)", () => {
      process.env.MANAGER_GATE_FAILSAFE = 'true'
      expect(loadConfig().MANAGER_GATE_FAILSAFE).toBe(true)
      process.env.MANAGER_GATE_FAILSAFE = 'no'
      expect(loadConfig().MANAGER_GATE_FAILSAFE).toBe(true)
    })
  })

  describe('EVENT_SOURCED_SESSION (이벤트소싱 flag)', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key'
      process.env.MODE = 'local'
    })
    it('미설정이면 기본 false(인메모리 폴백)', () => {
      delete process.env.EVENT_SOURCED_SESSION
      expect(loadConfig().EVENT_SOURCED_SESSION).toBe(false)
    })
    it("'true'면 true", () => {
      process.env.EVENT_SOURCED_SESSION = 'true'
      expect(loadConfig().EVENT_SOURCED_SESSION).toBe(true)
    })
    it('MANAGER_OUTBOX_POLL_MS 기본값은 500', () => {
      delete process.env.MANAGER_OUTBOX_POLL_MS
      expect(loadConfig().MANAGER_OUTBOX_POLL_MS).toBe(500)
    })
  })

  describe('TASK_MANAGER_ENABLED + lease 설정 (P1d-7 Supervisor)', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key'
      process.env.MODE = 'local'
    })
    it('TASK_MANAGER_ENABLED 미설정이면 기본 false(미배선)', () => {
      delete process.env.TASK_MANAGER_ENABLED
      expect(loadConfig().TASK_MANAGER_ENABLED).toBe(false)
    })
    it("TASK_MANAGER_ENABLED='true'면 true", () => {
      process.env.TASK_MANAGER_ENABLED = 'true'
      expect(loadConfig().TASK_MANAGER_ENABLED).toBe(true)
    })
    it('lease 기본값: sweep 30000·visibility 300000·maxAttempts 3', () => {
      delete process.env.MANAGER_LEASE_SWEEP_MS
      delete process.env.MANAGER_LEASE_VISIBILITY_MS
      delete process.env.MANAGER_LEASE_MAX_ATTEMPTS
      const c = loadConfig()
      expect(c.MANAGER_LEASE_SWEEP_MS).toBe(30_000)
      expect(c.MANAGER_LEASE_VISIBILITY_MS).toBe(300_000)
      expect(c.MANAGER_LEASE_MAX_ATTEMPTS).toBe(3)
    })
    it('lease env 오버라이드를 정수로 파싱한다', () => {
      process.env.MANAGER_LEASE_SWEEP_MS = '15000'
      expect(loadConfig().MANAGER_LEASE_SWEEP_MS).toBe(15_000)
    })
  })
})
