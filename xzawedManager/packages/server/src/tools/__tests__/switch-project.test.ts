import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSwitchProjectHandler } from '../switch-project.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('switch_project tool', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('프로젝트 전환 성공', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ projectId: 'proj-2', name: 'other-app', workspacePath: '/home/user/other' }),
    })

    const handler = createSwitchProjectHandler('http://localhost:3000', 'test-token')
    const result = await handler.execute({ projectId: 'proj-2' }, 'session-1')

    expect(result.projectId).toBe('proj-2')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/internal/sessions/session-1/switch-project')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ projectId: 'proj-2' })
  })

  it('Orchestrator 응답 오류 시 Error throw', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' })
    const handler = createSwitchProjectHandler('http://localhost:3000', 'test-token')
    await expect(
      handler.execute({ name: 'unknown-app' }, 'session-1'),
    ).rejects.toThrow('switch_project failed (404)')
  })
})
