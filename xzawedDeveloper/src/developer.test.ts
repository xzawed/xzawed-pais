import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Developer } from './developer.js'
import type { ManagerToDeveloperMessage } from './types.js'

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockProducer = { publish: mockPublish }

const mockGenerateChanges = vi.fn()
const mockRunner = { generateChanges: mockGenerateChanges }

const mockApplyFn = vi.fn().mockResolvedValue(undefined)

const config = {
  anthropicApiKey: 'sk-test',
  claudeModel: 'test',
  redisUrl: 'redis://localhost:6379',
  port: 3003,
  mode: 'local' as const,
  workspaceRoot: '/workspace',
}

function makeRequest(overrides?: Partial<ManagerToDeveloperMessage['payload']>): ManagerToDeveloperMessage {
  return {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'develop_request',
    payload: {
      plan: 'add auth middleware',
      projectPath: '/workspace/myapp',
      context: {},
      ...overrides,
    },
  }
}

let developer: Developer

beforeEach(() => {
  vi.resetAllMocks()
  mockApplyFn.mockResolvedValue(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  developer = new Developer(mockProducer as any, mockRunner as any, config, mockApplyFn)
})

describe('Developer.handle', () => {
  it('publishes develop_complete with artifacts and summary', async () => {
    mockGenerateChanges.mockResolvedValueOnce({
      changes: [
        { path: '/workspace/myapp/src/auth.ts', operation: 'create', content: 'x' },
        { path: '/workspace/myapp/src/old.ts', operation: 'delete' },
      ],
      summary: 'Added auth',
    })

    await developer.handle(makeRequest())

    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'develop_complete',
      payload: expect.objectContaining({
        artifacts: ['/workspace/myapp/src/auth.ts'],
        summary: 'Added auth',
      }),
    }))
  })

  it('excludes deleted files from artifacts', async () => {
    mockGenerateChanges.mockResolvedValueOnce({
      changes: [
        { path: '/workspace/myapp/a.ts', operation: 'delete' },
        { path: '/workspace/myapp/b.ts', operation: 'delete' },
      ],
      summary: 'Deleted files',
    })

    await developer.handle(makeRequest())

    const call = mockPublish.mock.calls[0]
    expect(call[1].payload.artifacts).toEqual([])
  })

  it('calls applyFn for each change', async () => {
    mockGenerateChanges.mockResolvedValueOnce({
      changes: [
        { path: '/workspace/myapp/a.ts', operation: 'create', content: '' },
        { path: '/workspace/myapp/b.ts', operation: 'modify', content: '' },
      ],
      summary: 'two changes',
    })

    await developer.handle(makeRequest())

    expect(mockApplyFn).toHaveBeenCalledTimes(2)
  })

  it('publishes error when runner throws', async () => {
    mockGenerateChanges.mockRejectedValueOnce(new Error('Claude timeout'))

    await developer.handle(makeRequest())

    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: 'Claude timeout' }),
    }))
  })

  it('publishes error when applyFn throws', async () => {
    mockGenerateChanges.mockResolvedValueOnce({
      changes: [{ path: '/workspace/myapp/src/a.ts', operation: 'create', content: '' }],
      summary: 'x',
    })
    mockApplyFn.mockRejectedValueOnce(new Error('경로 거부: /etc/evil'))

    await developer.handle(makeRequest())

    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: '경로 거부: /etc/evil' }),
    }))
  })

  it('returns immediately on abort without publishing', async () => {
    const abortMsg: ManagerToDeveloperMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-2',
      timestamp: Date.now(),
      type: 'abort',
      payload: { plan: '', projectPath: '', context: {} },
    }

    await developer.handle(abortMsg)

    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockGenerateChanges).not.toHaveBeenCalled()
  })

  it('error payload uses fallback message for non-Error throws', async () => {
    mockGenerateChanges.mockRejectedValueOnce('string error')

    await developer.handle(makeRequest())

    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: 'Unknown error' }),
    }))
  })
})
