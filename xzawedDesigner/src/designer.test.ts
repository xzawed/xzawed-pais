import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Designer } from './designer.js'
import type { ManagerToDesignerMessage } from './types.js'

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockProducer = { publish: mockPublish }

const mockGenerateDesign = vi.fn()
const mockRunner = { generateDesign: mockGenerateDesign }

const defaultDesignResult = {
  components: [{ name: 'LoginForm', description: 'form', props: {} }],
  uiSpec: { type: 'mockup_viewer' as const, title: 'Login', content: 'login page' },
}

function makeRequest(overrides?: Partial<ManagerToDesignerMessage['payload']>): ManagerToDesignerMessage {
  return {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    timestamp: Date.now(),
    type: 'design_request',
    payload: {
      intent: 'login form',
      context: {},
      ...overrides,
    },
  }
}

let designer: Designer

beforeEach(() => {
  vi.resetAllMocks()
  mockPublish.mockResolvedValue(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  designer = new Designer(mockProducer as any, mockRunner as any)
})

describe('Designer.handle', () => {
  it('publishes design_complete with components and uiSpec', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'design_complete',
      payload: expect.objectContaining({
        components: defaultDesignResult.components,
        uiSpec: defaultDesignResult.uiSpec,
      }),
    }))
  })

  it('returns immediately on abort without publishing', async () => {
    const abort: ManagerToDesignerMessage = {
      sessionId: 'sess-1', messageId: 'msg-2', timestamp: Date.now(),
      type: 'abort',
      payload: { intent: '', context: {} },
    }
    await designer.handle(abort)
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockGenerateDesign).not.toHaveBeenCalled()
  })

  it('publishes error when runner throws', async () => {
    mockGenerateDesign.mockRejectedValueOnce(new Error('Claude timeout'))
    await designer.handle(makeRequest())
    expect(mockPublish).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'error',
      payload: expect.objectContaining({ content: 'Claude timeout' }),
    }))
  })

  it('passes targetFramework and designSystem to runner', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest({ targetFramework: 'vue', designSystem: 'material' }))
    expect(mockGenerateDesign).toHaveBeenCalledWith(
      'login form', {}, 'vue', 'material'
    )
  })

  it('uses react/tailwind defaults when framework/system absent', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    expect(mockGenerateDesign).toHaveBeenCalledWith(
      'login form', {}, 'react', 'tailwind'
    )
  })

  it('design_complete content mentions component count', async () => {
    mockGenerateDesign.mockResolvedValueOnce(defaultDesignResult)
    await designer.handle(makeRequest())
    const call = mockPublish.mock.calls[0]
    expect(call[1].payload.content).toContain('1 component')
  })
})
