export interface WatchEntry {
  watcherId: string
  watcher: { close(): Promise<void> }
  timers: Map<string, ReturnType<typeof setTimeout>>
}

export class WatcherStore {
  private readonly entries = new Map<string, WatchEntry>()

  constructor(private readonly maxWatchers: number) {}

  add(sessionId: string, entry: WatchEntry): void {
    if (this.entries.size >= this.maxWatchers) {
      throw new Error(`최대 감시자 수(${this.maxWatchers}개) 초과`)
    }
    this.entries.set(sessionId, entry)
  }

  get(sessionId: string): WatchEntry | undefined {
    return this.entries.get(sessionId)
  }

  async remove(sessionId: string): Promise<WatchEntry | undefined> {
    const entry = this.entries.get(sessionId)
    if (!entry) return undefined
    this.entries.delete(sessionId)
    for (const timer of entry.timers.values()) {
      clearTimeout(timer)
    }
    entry.timers.clear()
    await entry.watcher.close()
    return entry
  }

  async stopAll(): Promise<void> {
    for (const sessionId of [...this.entries.keys()]) {
      await this.remove(sessionId)
    }
  }

  get size(): number {
    return this.entries.size
  }
}
