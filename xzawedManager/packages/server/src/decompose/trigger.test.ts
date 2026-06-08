import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { handleDecomposeRequest } from './trigger.js'
import type { ProduceDeps } from './producer.js'

function mockDecompose(publish: ProduceDeps['publish']): ProduceDeps {
  const claude: ClaudeLike = {
    messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"workPackages":[{"ref":"a","storyId":"s","owningRole":"developer","acceptanceCriteria":["x"],"dependsOn":[]}]}' }] }) },
  }
  return { claude, model: 'm', publish, now: () => 1 }
}

describe('handleDecomposeRequest', () => {
  it('분해 발행 + task_complete 발행 + cleanup 호출', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await handleDecomposeRequest('sess-1', 'build it', mockDecompose(emitPublish), { publish: producerPublish }, cleanup)

    expect(emitPublish).toHaveBeenCalledTimes(1)
    expect(producerPublish).toHaveBeenCalledTimes(1)
    const completeMsg = producerPublish.mock.calls[0]![0]
    expect(completeMsg.type).toBe('task_complete')
    expect(completeMsg.sessionId).toBe('sess-1')
    expect(completeMsg.payload.content).toContain('1')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('생산 실패해도 cleanup은 보장(finally)', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const badProducer = { publish: vi.fn().mockRejectedValue(new Error('publish fail')) }
    const failingDecompose = mockDecompose(vi.fn().mockRejectedValue(new Error('emit fail')))
    await expect(
      handleDecomposeRequest('sess-2', 'x', failingDecompose, badProducer, cleanup),
    ).rejects.toThrow()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
