import { describe, it, expect } from 'vitest'
import { createPlanTaskHandler } from '../../src/tools/plan-task.js'
import { createDevelopCodeHandler } from '../../src/tools/develop-code.js'
import { createDesignUiHandler } from '../../src/tools/design-ui.js'
import { createRunTestsHandler } from '../../src/tools/run-tests.js'
import { createBuildProjectHandler } from '../../src/tools/build-project.js'
import { createWatchChangesHandler } from '../../src/tools/watch-changes.js'
import { createSecurityAuditHandler } from '../../src/tools/security-audit.js'

describe('tool handlers', () => {
  it('createPlanTaskHandler creates handler with plan_task name and correct inputSchema', () => {
    const handler = createPlanTaskHandler('redis://localhost:6379')
    expect(handler.name).toBe('plan_task')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('intent')
    expect(schema.required).toContain('context')
    expect(schema.required).toContain('priority')
  })

  it('createDevelopCodeHandler creates handler with develop_code name and correct inputSchema', () => {
    const handler = createDevelopCodeHandler('redis://localhost:6379')
    expect(handler.name).toBe('develop_code')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('plan')
    expect(schema.required).toContain('projectPath')
    expect(schema.required).toContain('context')
  })

  it('createDesignUiHandler creates handler with design_ui name and correct inputSchema', () => {
    const handler = createDesignUiHandler('redis://localhost:6379')
    expect(handler.name).toBe('design_ui')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('intent')
    expect(schema.required).toContain('context')
  })

  it('createRunTestsHandler creates handler with run_tests name and correct inputSchema', () => {
    const handler = createRunTestsHandler('redis://localhost:6379')
    expect(handler.name).toBe('run_tests')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('projectPath')
    expect(schema.required).toContain('context')
  })

  it('createBuildProjectHandler creates handler with build_project name and correct inputSchema', () => {
    const handler = createBuildProjectHandler('redis://localhost:6379')
    expect(handler.name).toBe('build_project')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('projectPath')
    expect(schema.required).toContain('target')
    expect(schema.required).toContain('context')
  })

  it('createWatchChangesHandler creates handler with watch_changes name and correct inputSchema', () => {
    const handler = createWatchChangesHandler('redis://localhost:6379')
    expect(handler.name).toBe('watch_changes')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('projectPath')
    expect(schema.required).toContain('triggers')
    expect(schema.required).toContain('context')
  })

  it('createSecurityAuditHandler creates handler with security_audit name and correct inputSchema', () => {
    const handler = createSecurityAuditHandler('redis://localhost:6379')
    expect(handler.name).toBe('security_audit')
    expect(handler.description).toBeTruthy()
    const schema = handler.inputSchema as { required: string[] }
    expect(schema.required).toContain('artifacts')
    expect(schema.required).toContain('severity')
    expect(schema.required).toContain('projectPath')
    expect(schema.required).toContain('context')
  })
})
