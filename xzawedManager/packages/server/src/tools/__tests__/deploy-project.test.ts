import { describe, it, expect } from 'vitest'
import { createDeployProjectHandler } from '../deploy-project.js'

describe('deploy_project 도구', () => {
  it('도구 이름이 deploy_project이다', () => {
    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    expect(handler.name).toBe('deploy_project')
  })

  it('description에 GitHub이 포함된다', () => {
    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    expect(handler.description).toContain('GitHub')
  })

  it('inputSchema에 필수 필드가 있다', () => {
    const handler = createDeployProjectHandler('test-token', 'redis://localhost')
    const required = (handler.inputSchema as { required: string[] }).required
    expect(required).toContain('projectPath')
    expect(required).toContain('owner')
    expect(required).toContain('repo')
    expect(required).toContain('branch')
    expect(required).toContain('commitMessage')
  })
})
