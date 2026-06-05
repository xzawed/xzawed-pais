import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GATE_CONFIG, effectiveMode, isGatedTool,
  summarizeOutput, parseDecision, GATED_TOOLS,
  isKnowledgeBearingStage, KNOWLEDGE_BEARING_STAGES,
  buildDemoSpec,
} from './approval-gate.js'

describe('isGatedTool', () => {
  it('에이전트 디스패치 도구는 게이트 대상', () => {
    expect(isGatedTool('plan_task')).toBe(true)
    expect(isGatedTool('security_audit')).toBe(true)
  })
  it('배포 도구도 게이트 대상', () => {
    expect(isGatedTool('deploy_project')).toBe(true)
  })
  it('보조 도구는 비대상', () => {
    expect(isGatedTool('register_project')).toBe(false)
    expect(isGatedTool('github_ops')).toBe(false)
    expect(isGatedTool('request_info')).toBe(false)
  })
  it('GATED_TOOLS는 7개(배포 제외)', () => {
    expect(GATED_TOOLS.size).toBe(7)
  })
})

describe('배포 게이트(항상 manual)', () => {
  it('defaultMode가 auto여도 배포는 manual', () => {
    const cfg = { defaultMode: 'auto' as const, overrides: {} }
    expect(effectiveMode(cfg, 'deploy_project')).toBe('manual')
  })
  it('override로 auto를 줘도 배포는 manual', () => {
    const cfg = { defaultMode: 'manual' as const, overrides: { deploy_project: 'auto' as const } }
    expect(effectiveMode(cfg, 'deploy_project')).toBe('manual')
  })
})

describe('effectiveMode', () => {
  it('기본은 manual', () => {
    expect(effectiveMode(DEFAULT_GATE_CONFIG, 'plan_task')).toBe('manual')
  })
  it('override가 defaultMode를 이긴다', () => {
    const cfg = { defaultMode: 'manual' as const, overrides: { plan_task: 'auto' as const } }
    expect(effectiveMode(cfg, 'plan_task')).toBe('auto')
    expect(effectiveMode(cfg, 'design_ui')).toBe('manual')
  })
  it('defaultMode auto면 override 없는 단계는 auto', () => {
    const cfg = { defaultMode: 'auto' as const, overrides: { design_ui: 'manual' as const } }
    expect(effectiveMode(cfg, 'plan_task')).toBe('auto')
    expect(effectiveMode(cfg, 'design_ui')).toBe('manual')
  })
})

describe('parseDecision', () => {
  it('approve JSON', () => {
    expect(parseDecision('{"decision":"approve"}')).toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: false })
  })
  it('approve + rememberAuto', () => {
    expect(parseDecision('{"decision":"approve","rememberAuto":true}'))
      .toEqual({ kind: 'approve', rememberAuto: true, saveToWiki: false })
  })
  it('approve + saveToWiki', () => {
    expect(parseDecision('{"decision":"approve","saveToWiki":true}'))
      .toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: true })
  })
  it('approve + rememberAuto + saveToWiki', () => {
    expect(parseDecision('{"decision":"approve","rememberAuto":true,"saveToWiki":true}'))
      .toEqual({ kind: 'approve', rememberAuto: true, saveToWiki: true })
  })
  it('saveToWiki 누락/비boolean이면 false (fail-open)', () => {
    expect(parseDecision('{"decision":"approve"}')).toMatchObject({ saveToWiki: false })
    expect(parseDecision('{"decision":"approve","saveToWiki":"yes"}')).toMatchObject({ saveToWiki: false })
  })
  it('revise + feedback', () => {
    expect(parseDecision('{"decision":"revise","feedback":"색상 변경"}'))
      .toEqual({ kind: 'revise', feedback: '색상 변경' })
  })
  it('abort', () => {
    expect(parseDecision('{"decision":"abort"}')).toEqual({ kind: 'abort' })
  })
  it('파싱 불가 문자열은 fail-safe로 needs_human(자동 승인 금지)', () => {
    const d = parseDecision('그냥 진행')
    expect(d.kind).toBe('needs_human')
    expect((d as { reason: string }).reason).toBeTruthy()
  })
  it('파싱 불가 문자열은 failSafe=false면 레거시 approve(fail-open)', () => {
    expect(parseDecision('그냥 진행', false)).toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: false })
  })
  it('비객체(JSON 숫자/문자열)는 fail-safe로 needs_human', () => {
    expect(parseDecision('123').kind).toBe('needs_human')
    expect(parseDecision('"hello"').kind).toBe('needs_human')
    expect(parseDecision('123', false)).toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: false })
  })
  it('알 수 없는 decision 값은 fail-safe로 needs_human(레거시는 approve)', () => {
    expect(parseDecision('{"decision":"xxx"}').kind).toBe('needs_human')
    expect(parseDecision('{"decision":"xxx"}', false))
      .toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: false })
  })
  it('decision 키 누락은 fail-safe로 needs_human(레거시는 approve)', () => {
    expect(parseDecision('{"foo":1}').kind).toBe('needs_human')
    expect(parseDecision('{"foo":1}', false))
      .toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: false })
  })
  it('revise인데 feedback 없으면 빈 문자열', () => {
    expect(parseDecision('{"decision":"revise"}')).toEqual({ kind: 'revise', feedback: '' })
  })
  it('approve + wikiSummary(PO 편집 요약)를 포함한다', () => {
    expect(parseDecision('{"decision":"approve","saveToWiki":true,"wikiSummary":"PO가 다듬은 결정"}'))
      .toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: true, wikiSummary: 'PO가 다듬은 결정' })
  })
  it('wikiSummary 누락이면 approve에 wikiSummary 키가 없다', () => {
    const d = parseDecision('{"decision":"approve","saveToWiki":true}')
    expect(d).toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: true })
    expect('wikiSummary' in d).toBe(false)
  })
  it('wikiSummary가 비문자열이면 무시(fail-open)', () => {
    expect(parseDecision('{"decision":"approve","saveToWiki":true,"wikiSummary":123}'))
      .toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: true })
  })
  it('wikiSummary가 공백뿐이면 무시(자동 요약으로 폴백)', () => {
    expect(parseDecision('{"decision":"approve","saveToWiki":true,"wikiSummary":"   "}'))
      .toEqual({ kind: 'approve', rememberAuto: false, saveToWiki: true })
  })
  it('wikiSummary가 2000자 초과면 잘린다', () => {
    const long = 'x'.repeat(5000)
    const d = parseDecision(JSON.stringify({ decision: 'approve', saveToWiki: true, wikiSummary: long })) as {
      kind: 'approve'; wikiSummary: string
    }
    expect(d.wikiSummary.length).toBeLessThanOrEqual(2000 + '...[truncated]'.length)
    expect(d.wikiSummary.endsWith('...[truncated]')).toBe(true)
  })
})

describe('isKnowledgeBearingStage', () => {
  it('지식성 4단계는 true', () => {
    expect(isKnowledgeBearingStage('plan_task')).toBe(true)
    expect(isKnowledgeBearingStage('design_ui')).toBe(true)
    expect(isKnowledgeBearingStage('develop_code')).toBe(true)
    expect(isKnowledgeBearingStage('security_audit')).toBe(true)
  })
  it('일시 산출물 단계·배포는 false', () => {
    expect(isKnowledgeBearingStage('run_tests')).toBe(false)
    expect(isKnowledgeBearingStage('build_project')).toBe(false)
    expect(isKnowledgeBearingStage('watch_changes')).toBe(false)
    expect(isKnowledgeBearingStage('deploy_project')).toBe(false)
  })
  it('KNOWLEDGE_BEARING_STAGES는 4개', () => {
    expect(KNOWLEDGE_BEARING_STAGES.size).toBe(4)
  })
})

describe('summarizeOutput', () => {
  it('객체를 JSON 문자열로 요약하되 상한 길이로 자른다', () => {
    const s = summarizeOutput('plan_task', { content: 'x'.repeat(5000) })
    expect(s.length).toBeLessThanOrEqual(2000 + '...[truncated]'.length)
    expect(s.endsWith('...[truncated]')).toBe(true)
  })
  it('content 필드가 있으면 우선 사용', () => {
    const s = summarizeOutput('design_ui', { content: '로그인 폼', uiSpec: { type: 'form' } })
    expect(s).toContain('로그인 폼')
  })
  it('content 없으면 전체 직렬화', () => {
    const s = summarizeOutput('run_tests', { passed: 10, failed: 0 })
    expect(s).toContain('passed')
  })
})

describe('buildDemoSpec', () => {
  it('design_ui 결과의 components를 UISpec으로 병합한다', () => {
    const result = {
      components: [{ name: 'Card', description: 'c', props: {} }],
      uiSpec: { type: 'mockup_viewer', title: 'Demo' },
      content: '요약 텍스트',
    }
    const spec = buildDemoSpec('design_ui', result)
    expect(spec).toBeDefined()
    expect(spec?.type).toBe('mockup_viewer')
    expect(spec?.title).toBe('Demo')
    expect(spec?.content).toBe('요약 텍스트')
    expect(spec?.components).toHaveLength(1)
  })
  it('content만 있어도 UISpec을 만든다', () => {
    const spec = buildDemoSpec('design_ui', { uiSpec: { type: 'progress_board' }, content: '3/5', components: [] })
    expect(spec?.type).toBe('progress_board')
    expect(spec?.content).toBe('3/5')
  })
  it('design_ui가 아니면 undefined', () => {
    expect(buildDemoSpec('plan_task', { components: [{ name: 'X', description: '', props: {} }] })).toBeUndefined()
  })
  it('표시할 내용(components·content)이 없으면 undefined', () => {
    expect(buildDemoSpec('design_ui', { uiSpec: { type: 'form' }, components: [] })).toBeUndefined()
  })
  it('객체가 아닌 결과면 undefined', () => {
    expect(buildDemoSpec('design_ui', 'oops')).toBeUndefined()
  })
  it('알 수 없는 type은 mockup_viewer로 폴백한다', () => {
    const spec = buildDemoSpec('design_ui', { uiSpec: { type: 'weird' }, content: 'x' })
    expect(spec?.type).toBe('mockup_viewer')
  })
})
