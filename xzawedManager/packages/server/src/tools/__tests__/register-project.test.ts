import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRegisterProjectHandler } from '../register-project.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('register_project tool', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('로컬 프로젝트 등록 시 Orchestrator POST 호출', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ projectId: 'proj-1', workspacePath: '/home/user/app', status: 'registered' }),
    })

    const handler = createRegisterProjectHandler('http://localhost:3000', 'test-token')
    const result = await handler.execute(
      { name: 'my-app', workspaceType: 'local', localPath: '/home/user/app' },
      'session-1',
    )

    expect(result.projectId).toBe('proj-1')
    expect(result.workspacePath).toBe('/home/user/app')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/internal/sessions/session-1/register-project')
    expect(opts.method).toBe('POST')
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-token')
  })

  it('Orchestrator 응답 오류 시 Error throw', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad Request' })
    const handler = createRegisterProjectHandler('http://localhost:3000', 'test-token')
    await expect(
      handler.execute({ name: 'app', workspaceType: 'local', localPath: '/x' }, 'session-1'),
    ).rejects.toThrow('register_project failed (400)')
  })

  it('잘못된 URL 프로토콜 시 Error throw', async () => {
    const handler = createRegisterProjectHandler('ftp://bad-url', 'test-token')
    await expect(
      handler.execute({ name: 'app', workspaceType: 'local', localPath: '/x' }, 'session-1'),
    ).rejects.toThrow('Invalid orchestrator URL protocol')
  })
})
