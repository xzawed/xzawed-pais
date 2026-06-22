import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from './config.js'

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
