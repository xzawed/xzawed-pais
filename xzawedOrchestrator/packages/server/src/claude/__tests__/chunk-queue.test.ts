import { describe, it, expect } from 'vitest'
import { ChunkQueue } from '../chunk-queue.js'
import type { Chunk } from '@xzawed/shared'

function makeChunk(content: string): Chunk {
  return { type: 'text_delta', content } as unknown as Chunk
}

async function collect(queue: ChunkQueue): Promise<Chunk[]> {
  const result: Chunk[] = []
  for await (const chunk of queue) result.push(chunk)
  return result
}

describe('ChunkQueue', () => {
  it('push 후 close 시 순서대로 yield한다', async () => {
    const q = new ChunkQueue()
    q.push(makeChunk('a'))
    q.push(makeChunk('b'))
    q.push(makeChunk('c'))
    q.close()
    const chunks = await collect(q)
    expect(chunks).toHaveLength(3)
    expect((chunks[0] as unknown as { content: string }).content).toBe('a')
    expect((chunks[1] as unknown as { content: string }).content).toBe('b')
    expect((chunks[2] as unknown as { content: string }).content).toBe('c')
  })

  it('close() 후 pending 아이템이 모두 소진된다', async () => {
    const q = new ChunkQueue()
    q.push(makeChunk('x'))
    q.push(makeChunk('y'))
    q.close()
    const chunks = await collect(q)
    expect(chunks).toHaveLength(2)
  })

  it('빈 큐에서 close() 하면 즉시 iteration이 종료된다', async () => {
    const q = new ChunkQueue()
    q.close()
    const chunks = await collect(q)
    expect(chunks).toHaveLength(0)
  })

  it('close() 이후 push()한 아이템은 pending에 남아 소진 후 종료된다', async () => {
    const q = new ChunkQueue()
    q.close()
    q.push(makeChunk('late'))
    // 구현 상 pending 드레인 후 closed 체크: close 후 push된 아이템도 yield됨
    const chunks = await collect(q)
    expect(chunks).toHaveLength(1)
    expect((chunks[0] as unknown as { content: string }).content).toBe('late')
  })

  it('비동기 push — 이미 대기 중인 iterator에 즉시 전달된다', async () => {
    const q = new ChunkQueue()
    const collectPromise = collect(q)
    await Promise.resolve()
    q.push(makeChunk('async-item'))
    q.close()
    const chunks = await collectPromise
    expect(chunks).toHaveLength(1)
    expect((chunks[0] as unknown as { content: string }).content).toBe('async-item')
  })

  it('여러 chunk를 순차 push하면 FIFO 순서를 보장한다', async () => {
    const q = new ChunkQueue()
    const items = ['first', 'second', 'third', 'fourth', 'fifth']
    for (const s of items) q.push(makeChunk(s))
    q.close()
    const chunks = await collect(q)
    for (let i = 0; i < items.length; i++) {
      expect((chunks[i] as unknown as { content: string }).content).toBe(items[i])
    }
  })
})
