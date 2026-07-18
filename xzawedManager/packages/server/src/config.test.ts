import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, resolveProfileEnv } from './config.js'

/** 공통 env(MODE·ANTHROPIC_API_KEY) 저장/복원 + 추가 키 정리. 블록 내에서 호출. */
function withBaseEnv(extraKeys: string[]): void {
  let savedMode: string | undefined
  let savedKey: string | undefined
  beforeEach(() => {
    savedMode = process.env['MODE']; savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'; process.env['ANTHROPIC_API_KEY'] = 'k'
  })
  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode; else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey; else delete process.env['ANTHROPIC_API_KEY']
    for (const k of extraKeys) delete process.env[k]
  })
}

describe('config CLAUDE_TIMEOUT_MS', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['CLAUDE_TIMEOUT_MS']
  })

  it('기본값 120000', () => {
    delete process.env['CLAUDE_TIMEOUT_MS']
    expect(loadConfig().CLAUDE_TIMEOUT_MS).toBe(120000)
  })

  it('env 값 적용', () => {
    process.env['CLAUDE_TIMEOUT_MS'] = '5000'
    expect(loadConfig().CLAUDE_TIMEOUT_MS).toBe(5000)
  })
})

describe('config MANAGER_DECOMPOSE_REPAIR_MAX', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_DECOMPOSE_REPAIR_MAX']
  })

  it('기본값 2', () => {
    delete process.env['MANAGER_DECOMPOSE_REPAIR_MAX']
    expect(loadConfig().MANAGER_DECOMPOSE_REPAIR_MAX).toBe(2)
  })

  it('env 값 적용', () => {
    process.env['MANAGER_DECOMPOSE_REPAIR_MAX'] = '5'
    expect(loadConfig().MANAGER_DECOMPOSE_REPAIR_MAX).toBe(5)
  })
})

describe('MANAGER_ORACLE_DOR flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_ORACLE_DOR']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_ORACLE_DOR']
    expect(loadConfig().MANAGER_ORACLE_DOR).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_ORACLE_DOR'] = 'true'
    expect(loadConfig().MANAGER_ORACLE_DOR).toBe(true)
  })
})

describe('MANAGER_ORACLE_DRAFT flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_ORACLE_DRAFT']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_ORACLE_DRAFT']
    expect(loadConfig().MANAGER_ORACLE_DRAFT).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_ORACLE_DRAFT'] = 'true'
    expect(loadConfig().MANAGER_ORACLE_DRAFT).toBe(true)
  })
})

describe('MANAGER_TASK_WORKER flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_TASK_WORKER']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_TASK_WORKER']
    expect(loadConfig().MANAGER_TASK_WORKER).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_TASK_WORKER'] = 'true'
    expect(loadConfig().MANAGER_TASK_WORKER).toBe(true)
  })
})

describe('MANAGER_WP_VERIFY flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_VERIFY']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_WP_VERIFY']
    expect(loadConfig().MANAGER_WP_VERIFY).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_WP_VERIFY'] = 'true'
    expect(loadConfig().MANAGER_WP_VERIFY).toBe(true)
  })
})

describe('MANAGER_WP_CONFORMANCE flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_CONFORMANCE']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_WP_CONFORMANCE']
    expect(loadConfig().MANAGER_WP_CONFORMANCE).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_WP_CONFORMANCE'] = 'true'
    expect(loadConfig().MANAGER_WP_CONFORMANCE).toBe(true)
  })
})

describe('MANAGER_WP_IMPACT flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_IMPACT']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_WP_IMPACT']
    expect(loadConfig().MANAGER_WP_IMPACT).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_WP_IMPACT'] = 'true'
    expect(loadConfig().MANAGER_WP_IMPACT).toBe(true)
  })
})

describe('MANAGER_WP_PROPERTY flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_PROPERTY']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_WP_PROPERTY']
    expect(loadConfig().MANAGER_WP_PROPERTY).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_WP_PROPERTY'] = 'true'
    expect(loadConfig().MANAGER_WP_PROPERTY).toBe(true)
  })
})

describe('MANAGER_WP_ADVISORY flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_ADVISORY']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_WP_ADVISORY']
    expect(loadConfig().MANAGER_WP_ADVISORY).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_WP_ADVISORY'] = 'true'
    expect(loadConfig().MANAGER_WP_ADVISORY).toBe(true)
  })
})

describe('MANAGER_WP_MUTATION flag + mutation env', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_MUTATION']
    delete process.env['MANAGER_MUTATION_THETA']
    delete process.env['MANAGER_MUTATION_MIN_RISK']
    delete process.env['MANAGER_MUTATION_MAX_MUTANTS']
  })

  it('MANAGER_WP_MUTATION 기본 false', () => {
    delete process.env['MANAGER_WP_MUTATION']
    expect(loadConfig().MANAGER_WP_MUTATION).toBe(false)
  })
  it("MANAGER_WP_MUTATION 'true'면 true", () => {
    process.env['MANAGER_WP_MUTATION'] = 'true'
    expect(loadConfig().MANAGER_WP_MUTATION).toBe(true)
  })
  it('MANAGER_MUTATION_THETA 기본 0.6·파싱', () => {
    delete process.env['MANAGER_MUTATION_THETA']
    expect(loadConfig().MANAGER_MUTATION_THETA).toBe(0.6)
    process.env['MANAGER_MUTATION_THETA'] = '0.8'
    expect(loadConfig().MANAGER_MUTATION_THETA).toBe(0.8)
  })
  it('MANAGER_MUTATION_MIN_RISK 기본 HIGH·불량값 catch', () => {
    delete process.env['MANAGER_MUTATION_MIN_RISK']
    expect(loadConfig().MANAGER_MUTATION_MIN_RISK).toBe('HIGH')
    process.env['MANAGER_MUTATION_MIN_RISK'] = 'MEDIUM'
    expect(loadConfig().MANAGER_MUTATION_MIN_RISK).toBe('MEDIUM')
    process.env['MANAGER_MUTATION_MIN_RISK'] = 'garbage'
    expect(loadConfig().MANAGER_MUTATION_MIN_RISK).toBe('HIGH')
  })
  it('MANAGER_MUTATION_MAX_MUTANTS 기본 10', () => {
    delete process.env['MANAGER_MUTATION_MAX_MUTANTS']
    expect(loadConfig().MANAGER_MUTATION_MAX_MUTANTS).toBe(10)
  })
})

describe('MANAGER_RELEASE_GATE flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_RELEASE_GATE']
  })

  it('defaults false; "true" → true', () => {
    delete process.env['MANAGER_RELEASE_GATE']
    expect(loadConfig().MANAGER_RELEASE_GATE).toBe(false)
    process.env['MANAGER_RELEASE_GATE'] = 'true'
    expect(loadConfig().MANAGER_RELEASE_GATE).toBe(true)
  })
})

describe('config MANAGER_DEPLOY_GATE', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined
  beforeEach(() => {
    savedMode = process.env['MODE']; savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'; process.env['ANTHROPIC_API_KEY'] = 'k'
  })
  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode; else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey; else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_DEPLOY_GATE']
  })
  it('미설정 → false', () => {
    delete process.env['MANAGER_DEPLOY_GATE']
    expect(loadConfig().MANAGER_DEPLOY_GATE).toBe(false)
  })
  it('"true" → true', () => {
    process.env['MANAGER_DEPLOY_GATE'] = 'true'
    expect(loadConfig().MANAGER_DEPLOY_GATE).toBe(true)
  })
})

describe('config MANAGER_DECISION_EXPIRY / TTL / SWEEP', () => {
  withBaseEnv(['MANAGER_DECISION_EXPIRY', 'MANAGER_DECISION_TTL_HOURS', 'MANAGER_DECISION_SWEEP_MS'])
  it('EXPIRY 미설정 → false·TTL 기본 72·SWEEP 기본 60000', () => {
    const c = loadConfig()
    expect(c.MANAGER_DECISION_EXPIRY).toBe(false)
    expect(c.MANAGER_DECISION_TTL_HOURS).toBe(72)
    expect(c.MANAGER_DECISION_SWEEP_MS).toBe(60_000)
  })
  it('EXPIRY "true" → true·TTL/SWEEP env 적용', () => {
    process.env['MANAGER_DECISION_EXPIRY'] = 'true'; process.env['MANAGER_DECISION_TTL_HOURS'] = '24'; process.env['MANAGER_DECISION_SWEEP_MS'] = '5000'
    const c = loadConfig()
    expect(c.MANAGER_DECISION_EXPIRY).toBe(true); expect(c.MANAGER_DECISION_TTL_HOURS).toBe(24); expect(c.MANAGER_DECISION_SWEEP_MS).toBe(5000)
  })
})

describe('MANAGER_WP_SECURITY flag + min severity', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_WP_SECURITY']
    delete process.env['MANAGER_WP_SECURITY_MIN_SEVERITY']
  })

  it('MANAGER_WP_SECURITY 기본 false', () => {
    delete process.env['MANAGER_WP_SECURITY']
    expect(loadConfig().MANAGER_WP_SECURITY).toBe(false)
  })
  it("MANAGER_WP_SECURITY 'true'면 true", () => {
    process.env['MANAGER_WP_SECURITY'] = 'true'
    expect(loadConfig().MANAGER_WP_SECURITY).toBe(true)
  })
  it('MANAGER_WP_SECURITY_MIN_SEVERITY 기본 high·파싱·불량값 catch', () => {
    delete process.env['MANAGER_WP_SECURITY_MIN_SEVERITY']
    expect(loadConfig().MANAGER_WP_SECURITY_MIN_SEVERITY).toBe('high')
    process.env['MANAGER_WP_SECURITY_MIN_SEVERITY'] = 'critical'
    expect(loadConfig().MANAGER_WP_SECURITY_MIN_SEVERITY).toBe('critical')
    process.env['MANAGER_WP_SECURITY_MIN_SEVERITY'] = 'garbage'
    expect(loadConfig().MANAGER_WP_SECURITY_MIN_SEVERITY).toBe('high')
  })
})

describe('MANAGER_RISK_CLASSIFY flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_RISK_CLASSIFY']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_RISK_CLASSIFY']
    expect(loadConfig().MANAGER_RISK_CLASSIFY).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_RISK_CLASSIFY'] = 'true'
    expect(loadConfig().MANAGER_RISK_CLASSIFY).toBe(true)
  })
})

describe('MANAGER_RISK_ROUTING flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_RISK_ROUTING']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_RISK_ROUTING']
    expect(loadConfig().MANAGER_RISK_ROUTING).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_RISK_ROUTING'] = 'true'
    expect(loadConfig().MANAGER_RISK_ROUTING).toBe(true)
  })
})

describe('MANAGER_RISK_DECISION flag', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_RISK_DECISION']
  })

  it('기본 false', () => {
    delete process.env['MANAGER_RISK_DECISION']
    expect(loadConfig().MANAGER_RISK_DECISION).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_RISK_DECISION'] = 'true'
    expect(loadConfig().MANAGER_RISK_DECISION).toBe(true)
  })
})

describe('config MANAGER_DECISION_REESCALATE_MAX', () => {
  withBaseEnv(['MANAGER_DECISION_REESCALATE_MAX'])
  it('기본값 1', () => {
    delete process.env['MANAGER_DECISION_REESCALATE_MAX']
    expect(loadConfig().MANAGER_DECISION_REESCALATE_MAX).toBe(1)
  })
  it("'3' → 3", () => {
    process.env['MANAGER_DECISION_REESCALATE_MAX'] = '3'
    expect(loadConfig().MANAGER_DECISION_REESCALATE_MAX).toBe(3)
  })
  it("'0' → 에러(positive)", () => {
    process.env['MANAGER_DECISION_REESCALATE_MAX'] = '0'
    expect(() => loadConfig()).toThrow()
  })
})

describe('MANAGER_MODEL_ROUTING + model id 기본값', () => {
  let savedMode: string | undefined
  let savedKey: string | undefined

  beforeEach(() => {
    savedMode = process.env['MODE']
    savedKey = process.env['ANTHROPIC_API_KEY']
    process.env['MODE'] = 'local'
    process.env['ANTHROPIC_API_KEY'] = 'k'
  })

  afterEach(() => {
    if (savedMode !== undefined) process.env['MODE'] = savedMode
    else delete process.env['MODE']
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MANAGER_MODEL_ROUTING']
    delete process.env['MANAGER_MODEL_OPUS']
    delete process.env['MANAGER_MODEL_SONNET']
  })

  it('MANAGER_MODEL_ROUTING 기본 false', () => {
    delete process.env['MANAGER_MODEL_ROUTING']
    expect(loadConfig().MANAGER_MODEL_ROUTING).toBe(false)
  })

  it("MANAGER_MODEL_ROUTING 'true'면 true", () => {
    process.env['MANAGER_MODEL_ROUTING'] = 'true'
    expect(loadConfig().MANAGER_MODEL_ROUTING).toBe(true)
  })

  it('MANAGER_MODEL_OPUS 기본값 claude-opus-4-8', () => {
    delete process.env['MANAGER_MODEL_OPUS']
    expect(loadConfig().MANAGER_MODEL_OPUS).toBe('claude-opus-4-8')
  })

  it('MANAGER_MODEL_SONNET 기본값 claude-sonnet-4-6', () => {
    delete process.env['MANAGER_MODEL_SONNET']
    expect(loadConfig().MANAGER_MODEL_SONNET).toBe('claude-sonnet-4-6')
  })
})

describe('MANAGER_DEGRADED_MODE flag', () => {
  withBaseEnv(['MANAGER_DEGRADED_MODE'])

  it('기본 false', () => {
    delete process.env['MANAGER_DEGRADED_MODE']
    expect(loadConfig().MANAGER_DEGRADED_MODE).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_DEGRADED_MODE'] = 'true'
    expect(loadConfig().MANAGER_DEGRADED_MODE).toBe(true)
  })
})

describe('MANAGER_MODE_SWEEP_MS', () => {
  withBaseEnv(['MANAGER_MODE_SWEEP_MS'])

  it('기본값 5000', () => {
    delete process.env['MANAGER_MODE_SWEEP_MS']
    expect(loadConfig().MANAGER_MODE_SWEEP_MS).toBe(5000)
  })

  it('env 값 적용', () => {
    process.env['MANAGER_MODE_SWEEP_MS'] = '2000'
    expect(loadConfig().MANAGER_MODE_SWEEP_MS).toBe(2000)
  })
})

describe('MANAGER_MODE_STABILITY_WINDOW_MS', () => {
  withBaseEnv(['MANAGER_MODE_STABILITY_WINDOW_MS'])

  it('기본값 60000', () => {
    delete process.env['MANAGER_MODE_STABILITY_WINDOW_MS']
    expect(loadConfig().MANAGER_MODE_STABILITY_WINDOW_MS).toBe(60000)
  })

  it('env 값 적용', () => {
    process.env['MANAGER_MODE_STABILITY_WINDOW_MS'] = '30000'
    expect(loadConfig().MANAGER_MODE_STABILITY_WINDOW_MS).toBe(30000)
  })
})

describe('config MANAGER_DEGRADED_ENFORCE', () => {
  withBaseEnv(['MANAGER_DEGRADED_ENFORCE'])

  it('기본값 false', () => {
    delete process.env['MANAGER_DEGRADED_ENFORCE']
    expect(loadConfig().MANAGER_DEGRADED_ENFORCE).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_DEGRADED_ENFORCE'] = 'true'
    expect(loadConfig().MANAGER_DEGRADED_ENFORCE).toBe(true)
  })
})

describe('config MANAGER_DEGRADED_SIGNOFF', () => {
  withBaseEnv(['MANAGER_DEGRADED_SIGNOFF'])

  it('기본값 false', () => {
    delete process.env['MANAGER_DEGRADED_SIGNOFF']
    expect(loadConfig().MANAGER_DEGRADED_SIGNOFF).toBe(false)
  })

  it("'true'면 true", () => {
    process.env['MANAGER_DEGRADED_SIGNOFF'] = 'true'
    expect(loadConfig().MANAGER_DEGRADED_SIGNOFF).toBe(true)
  })
})

describe('PAIS_PROFILE — resolveProfileEnv (순수)', () => {
  it('PAIS_PROFILE 미설정 시 env를 그대로 반환(회귀 0·동일 참조)', () => {
    const env = { FOO: 'bar' } as NodeJS.ProcessEnv
    expect(resolveProfileEnv(env)).toBe(env)
  })

  it('빈 문자열 PAIS_PROFILE도 미설정으로 취급(그대로 반환)', () => {
    const env = { PAIS_PROFILE: '' } as NodeJS.ProcessEnv
    expect(resolveProfileEnv(env)).toBe(env)
  })

  it('autonomous 프로필이 미설정 플래그를 검증된 기본값으로 채운다', () => {
    const out = resolveProfileEnv({ PAIS_PROFILE: 'autonomous' } as NodeJS.ProcessEnv)
    expect(out['TASK_MANAGER_ENABLED']).toBe('true')
    expect(out['MANAGER_DECOMPOSE_ENABLED']).toBe('true')
    expect(out['MANAGER_TASK_WORKER']).toBe('true')
    expect(out['MANAGER_WP_VERIFY']).toBe('true')
    expect(out['MANAGER_LEASE_VISIBILITY_MS']).toBe('600000')
    expect(out['MANAGER_BUDGET_PER_WORKFLOW_USD']).toBe('5')
    expect(out['MANAGER_BUDGET_DAILY_USD']).toBe('50')
  })

  it('개별 env가 프로필을 override한다(사용자 우선)', () => {
    const out = resolveProfileEnv({
      PAIS_PROFILE: 'autonomous',
      MANAGER_WP_VERIFY: 'false',
      MANAGER_LEASE_VISIBILITY_MS: '900000',
    } as NodeJS.ProcessEnv)
    expect(out['MANAGER_WP_VERIFY']).toBe('false') // 명시 override 우선
    expect(out['MANAGER_LEASE_VISIBILITY_MS']).toBe('900000')
    expect(out['TASK_MANAGER_ENABLED']).toBe('true') // 미설정은 프로필값
  })

  it('미지 프로필은 명확한 에러를 throw한다', () => {
    expect(() => resolveProfileEnv({ PAIS_PROFILE: 'bogus' } as NodeJS.ProcessEnv)).toThrow(
      /Unknown PAIS_PROFILE.*bogus/,
    )
  })
})

describe('PAIS_PROFILE — loadConfig 통합', () => {
  const PROFILE_KEYS = [
    'PAIS_PROFILE', 'TASK_MANAGER_ENABLED', 'MANAGER_DECOMPOSE_ENABLED', 'MANAGER_TASK_WORKER',
    'MANAGER_WP_VERIFY', 'MANAGER_LEASE_VISIBILITY_MS', 'MANAGER_BUDGET_PER_WORKFLOW_USD',
    'MANAGER_BUDGET_DAILY_USD', 'SERVICE_JWT_SECRET', 'DATABASE_URL',
  ]
  const BASE_KEYS = [...PROFILE_KEYS, 'ANTHROPIC_API_KEY', 'MODE']
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of BASE_KEYS) saved[k] = process.env[k]
    for (const k of PROFILE_KEYS) delete process.env[k]
    process.env['ANTHROPIC_API_KEY'] = 'k'
    process.env['MODE'] = 'local' // 테스트 환경 MODE='test'가 enum 파싱을 깨지 않도록(기존 withBaseEnv 패턴)
  })
  afterEach(() => {
    for (const k of BASE_KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
      else delete process.env[k]
    }
  })

  it('autonomous + JWT + DB → 자율 스택이 켜진다', () => {
    process.env['PAIS_PROFILE'] = 'autonomous'
    process.env['SERVICE_JWT_SECRET'] = 'x'.repeat(32)
    process.env['DATABASE_URL'] = 'postgres://localhost/db'
    const c = loadConfig()
    expect(c.TASK_MANAGER_ENABLED).toBe(true)
    expect(c.MANAGER_DECOMPOSE_ENABLED).toBe(true)
    expect(c.MANAGER_TASK_WORKER).toBe(true)
    expect(c.MANAGER_WP_VERIFY).toBe(true)
    expect(c.MANAGER_LEASE_VISIBILITY_MS).toBe(600_000)
    expect(c.MANAGER_BUDGET_PER_WORKFLOW_USD).toBe(5)
    expect(c.MANAGER_BUDGET_DAILY_USD).toBe(50)
  })

  it('autonomous인데 SERVICE_JWT_SECRET 없으면 기동 거부', () => {
    process.env['PAIS_PROFILE'] = 'autonomous'
    process.env['DATABASE_URL'] = 'postgres://localhost/db'
    expect(() => loadConfig()).toThrow(/SERVICE_JWT_SECRET/)
  })

  it('autonomous인데 DATABASE_URL 없으면 기동 거부', () => {
    process.env['PAIS_PROFILE'] = 'autonomous'
    process.env['SERVICE_JWT_SECRET'] = 'x'.repeat(32)
    expect(() => loadConfig()).toThrow(/DATABASE_URL/)
  })

  it('개별 override가 프로필보다 우선(MANAGER_WP_VERIFY=false)', () => {
    process.env['PAIS_PROFILE'] = 'autonomous'
    process.env['SERVICE_JWT_SECRET'] = 'x'.repeat(32)
    process.env['DATABASE_URL'] = 'postgres://localhost/db'
    process.env['MANAGER_WP_VERIFY'] = 'false'
    const c = loadConfig()
    expect(c.MANAGER_WP_VERIFY).toBe(false)
    expect(c.TASK_MANAGER_ENABLED).toBe(true) // 미override는 프로필값 유지
  })

  it('PAIS_PROFILE 미설정 시 자율 스택 기본 off(회귀 0)', () => {
    const c = loadConfig()
    expect(c.TASK_MANAGER_ENABLED).toBe(false)
    expect(c.MANAGER_WP_VERIFY).toBe(false)
    expect(c.MANAGER_LEASE_VISIBILITY_MS).toBe(300_000) // 기존 기본값 유지
  })

  it('미지 PAIS_PROFILE은 기동 거부(명확한 에러)', () => {
    process.env['PAIS_PROFILE'] = 'bogus'
    expect(() => loadConfig()).toThrow(/Unknown PAIS_PROFILE/)
  })
})

describe('G3 — MODE=remote 프로덕션 auth 하드페일', () => {
  const KEYS = ['MODE', 'SERVICE_JWT_SECRET', 'ANTHROPIC_API_KEY']
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    process.env['ANTHROPIC_API_KEY'] = 'k'
    delete process.env['SERVICE_JWT_SECRET']
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
      else delete process.env[k]
    }
  })

  it('MODE=remote인데 SERVICE_JWT_SECRET 없으면 기동 거부', () => {
    process.env['MODE'] = 'remote'
    expect(() => loadConfig()).toThrow(/SERVICE_JWT_SECRET/)
  })

  it('MODE=remote + SERVICE_JWT_SECRET(≥32) → 통과', () => {
    process.env['MODE'] = 'remote'
    process.env['SERVICE_JWT_SECRET'] = 'x'.repeat(32)
    expect(loadConfig().MODE).toBe('remote')
  })

  it('MODE=local(기본)은 SERVICE_JWT_SECRET 없어도 통과(회귀 0)', () => {
    process.env['MODE'] = 'local'
    expect(loadConfig().MODE).toBe('local')
  })
})
