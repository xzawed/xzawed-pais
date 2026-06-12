import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from './config.js'

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
