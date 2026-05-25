import type { Chunk } from '@xzawed/shared'

export class ChunkQueue {
  private readonly pending: Chunk[] = []
  private closed = false
  private wakeup: (() => void) | null = null

  push(chunk: Chunk): void {
    this.pending.push(chunk)
    this.signal()
  }

  close(): void {
    this.closed = true
    this.signal()
  }

  private signal(): void {
    if (this.wakeup) {
      const fn = this.wakeup
      this.wakeup = null
      fn()
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Chunk> {
    while (true) {
      while (this.pending.length > 0) {
        const next = this.pending.shift()
        if (next !== undefined) yield next
      }
      if (this.closed) break
      await new Promise<void>(r => {
        this.wakeup = r
        if (this.pending.length > 0 || this.closed) {
          this.wakeup = null
          r()
        }
      })
    }
  }
}
