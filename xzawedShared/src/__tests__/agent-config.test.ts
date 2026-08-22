import { describe, it, expect } from 'vitest'
import { baseAgentSchema, baseAgentEnv, makeAgentConfig } from '../config/agent-config.js'

/**
 * 에이전트 7종이 공유하는 설정 계약. 이 파일이 깨지면 일곱 서비스의 기동이 함께
 * 깨지므로, 이전에 각 서비스가 복사본으로 갖고 있던 성질을 여기서 한 번에 고정한다.
 */

const FULL = {
  ANTHROPIC_API_KEY: 'sk-test',
  CLAUDE_MODEL: 'claude-opus-5',
  REDIS_URL: 'redis://example:6379',
  PORT: '4321',
  MODE: 'remote',
  WORKSPACE_ROOT: '/workspace',
}

describe('baseAgentEnv — env 키 매핑', () => {
  it('여섯 개 env 키를 설정 필드명으로 옮긴다', () => {
    expect(baseAgentEnv(FULL)).toEqual({
      anthropicApiKey: 'sk-test',
      claudeModel: 'claude-opus-5',
      redisUrl: 'redis://example:6379',
      port: '4321',
      mode: 'remote',
      workspaceRoot: '/workspace',
    })
  })

  it('미설정 키는 undefined로 남긴다 — 기본값은 스키마가 채운다', () => {
    const out = baseAgentEnv({ ANTHROPIC_API_KEY: 'k', WORKSPACE_ROOT: '/w' })
    expect(out['claudeModel']).toBeUndefined()
    expect(out['port']).toBeUndefined()
  })
})

describe('baseAgentSchema — 공통 필드', () => {
  it('필수값이 채워지면 파싱된다', () => {
    const cfg = baseAgentSchema(3002).parse(baseAgentEnv(FULL))
    expect(cfg.port).toBe(4321)
    expect(cfg.mode).toBe('remote')
    expect(cfg.workspaceRoot).toBe('/workspace')
  })

  it('defaultPort는 PORT 미설정일 때만 쓰인다', () => {
    const cfg = baseAgentSchema(3002).parse(
      baseAgentEnv({ ANTHROPIC_API_KEY: 'k', WORKSPACE_ROOT: '/w' }),
    )
    expect(cfg.port).toBe(3002)
  })

  it('PORT를 문자열로 받아 숫자로 강제한다', () => {
    const cfg = baseAgentSchema(3002).parse(baseAgentEnv({ ...FULL, PORT: '3999' }))
    expect(cfg.port).toBe(3999)
    expect(typeof cfg.port).toBe('number')
  })

  it('기본값 — claudeModel·redisUrl·mode', () => {
    const cfg = baseAgentSchema(3002).parse(
      baseAgentEnv({ ANTHROPIC_API_KEY: 'k', WORKSPACE_ROOT: '/w' }),
    )
    expect(cfg.claudeModel).toBe('claude-sonnet-4-6')
    expect(cfg.redisUrl).toBe('redis://localhost:6379')
    expect(cfg.mode).toBe('local')
  })

  it('ANTHROPIC_API_KEY가 없으면 거부한다', () => {
    expect(() =>
      baseAgentSchema(3002).parse(baseAgentEnv({ WORKSPACE_ROOT: '/w' })),
    ).toThrow()
  })

  it('WORKSPACE_ROOT가 아예 없으면 거부한다', () => {
    expect(() =>
      baseAgentSchema(3002).parse(baseAgentEnv({ ANTHROPIC_API_KEY: 'k' })),
    ).toThrow()
  })

  it('WORKSPACE_ROOT가 빈 문자열이면 이유를 말한다', () => {
    // 커스텀 메시지는 min(1) 위반에만 붙는다 — 부재는 Zod의 invalid_type 이다.
    // 복사본 시절 이 메시지는 일곱 중 둘에만 있었다. 공통화로 전부에 붙는다.
    expect(() =>
      baseAgentSchema(3002).parse(baseAgentEnv({ ANTHROPIC_API_KEY: 'k', WORKSPACE_ROOT: '' })),
    ).toThrow(/WORKSPACE_ROOT is required/)
  })

  it('MODE는 local·remote만 받는다', () => {
    expect(() =>
      baseAgentSchema(3002).parse(baseAgentEnv({ ...FULL, MODE: 'staging' })),
    ).toThrow()
  })

  it('PORT가 0이나 음수면 거부한다', () => {
    for (const bad of ['0', '-1']) {
      expect(() => baseAgentSchema(3002).parse(baseAgentEnv({ ...FULL, PORT: bad }))).toThrow()
    }
  })
})

describe('baseAgentSchema — 서비스별 변형', () => {
  it('extend로 서비스 고유 필드를 얹을 수 있다', () => {
    const schema = baseAgentSchema(3005).extend({
      testTimeoutMs: baseAgentSchema(1).shape.port,
    })
    const cfg = schema.parse({ ...baseAgentEnv(FULL), testTimeoutMs: '9000' })
    expect(cfg.testTimeoutMs).toBe(9000)
  })

  it('omit으로 Claude 필드를 뺄 수 있다 — Watcher는 API 키가 없어도 기동한다', () => {
    const schema = baseAgentSchema(3007).omit({ anthropicApiKey: true, claudeModel: true })
    const cfg = schema.parse(baseAgentEnv({ REDIS_URL: 'redis://r:6379', WORKSPACE_ROOT: '/w' }))
    expect(cfg.port).toBe(3007)
    expect(cfg).not.toHaveProperty('anthropicApiKey')
  })

  it('omit한 스키마에 baseAgentEnv 전체를 넘겨도 안전하다 — Zod가 미지 키를 버린다', () => {
    const schema = baseAgentSchema(3007).omit({ anthropicApiKey: true, claudeModel: true })
    const cfg = schema.parse(baseAgentEnv(FULL))
    expect(cfg).not.toHaveProperty('anthropicApiKey')
    expect(cfg).not.toHaveProperty('claudeModel')
    expect(cfg.workspaceRoot).toBe('/workspace')
  })
})

describe('makeAgentConfig — 완성형 팩토리', () => {
  it('loadConfig가 env를 파싱해 설정을 낸다', () => {
    const { loadConfig } = makeAgentConfig(3003)
    expect(loadConfig(FULL).port).toBe(4321)
  })

  it('PORT 미설정이면 defaultPort를 쓴다', () => {
    const { loadConfig } = makeAgentConfig(3003)
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k', WORKSPACE_ROOT: '/w' })
    expect(cfg.port).toBe(3003)
  })

  it('필수값이 없으면 던진다 — 기동을 거부시키는 것이 계약이다', () => {
    const { loadConfig } = makeAgentConfig(3003)
    expect(() => loadConfig({})).toThrow()
  })

  it('schema도 함께 노출해 서비스가 확장할 수 있다', () => {
    const { schema } = makeAgentConfig(3006)
    const extended = schema.extend({ buildTimeoutMs: schema.shape.port })
    const cfg = extended.parse({ ...baseAgentEnv(FULL), buildTimeoutMs: '5000' })
    expect(cfg.buildTimeoutMs).toBe(5000)
  })
})
