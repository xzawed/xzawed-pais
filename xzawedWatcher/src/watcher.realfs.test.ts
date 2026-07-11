// Real-filesystem integration test for glob-based watching.
//
// watcher.test.ts fully mocks chokidar, so it never exercises real glob
// expansion. This test runs the ACTUAL chokidar against a real tmpdir to
// verify that a glob trigger ('**/*.ts') detects add/change/unlink and
// publishes file_changed end-to-end.
//
// Why it matters: chokidar v4+ dropped built-in glob support. Under a major
// bump, `chokidar.watch(['**/*.ts'])` would treat the glob as a literal path,
// silently watching nothing — a runtime regression that tsc and mock-based
// tests cannot catch (CI-green != safe). This test is that regression guard.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FSWatcher } from 'chokidar'

// Keep chokidar REAL. Only stub path validation so we can point cwd at a tmpdir.
vi.mock('./executor.js', () => ({
  validatePath: vi.fn((p: string) => Promise.resolve(p)),
}))

import { Watcher } from './watcher.js'
import { WatcherStore } from './watcher-store.js'
import type { Producer } from './streams/producer.js'
import type { ManagerToWatcherMessage, WatcherToManagerMessage } from './types.js'

const baseConfig = {
  redisUrl: 'redis://localhost:6379',
  port: 3007,
  mode: 'local' as const,
  workspaceRoot: '/workspace',
  maxWatchers: 10,
  debounceMs: 40,
}

interface CapturedChange { event: string; path: string }

function capturedChanges(publish: ReturnType<typeof vi.fn>): CapturedChange[] {
  return publish.mock.calls
    .map((c) => c[1] as WatcherToManagerMessage)
    .filter((m) => m?.type === 'file_changed')
    .flatMap((m) => (m.payload.changes ?? []) as CapturedChange[])
}

async function waitFor(pred: () => boolean, timeoutMs = 8000, intervalMs = 40): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

// chokidar fires 'ready' after the initial scan; we MUST wait for it (and let
// the native watcher settle) before creating files — with ignoreInitial:true a
// file created mid-scan is treated as pre-existing and never reported as 'add'.
// The fallback timeout must exceed a cold-start chokidar init (first instance in
// the process can take >1.5s), else it can beat real 'ready' and swallow events.
async function waitReady(store: WatcherStore, sessionId: string): Promise<void> {
  const entry = store.get(sessionId)
  expect(entry).toBeDefined()
  const fsw = entry!.watcher as unknown as FSWatcher
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    fsw.on('ready', finish)
    setTimeout(finish, 5000)
  })
  // settle: let the OS-level watch fully register before we mutate files
  await new Promise((r) => setTimeout(r, 400))
}

function watchRequest(dir: string, sessionId: string, triggers: string[]): ManagerToWatcherMessage {
  return {
    sessionId, messageId: `m-${sessionId}`, timestamp: Date.now(),
    type: 'watch_request',
    payload: { projectPath: dir, triggers, context: {} },
  }
}

describe('Watcher real-filesystem glob watching (integration)', () => {
  let dir: string
  let store: WatcherStore
  let watcher: Watcher
  let publish: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'watcher-realfs-'))
    publish = vi.fn().mockResolvedValue(undefined)
    store = new WatcherStore(10)
    watcher = new Watcher(
      { publish } as unknown as Producer,
      store,
      { ...baseConfig, workspaceRoot: dir },
    )
  })

  afterEach(async () => {
    await store.stopAll()
    await rm(dir, { recursive: true, force: true })
  })

  it('glob 트리거로 실제 파일 변경(생성/수정/삭제)을 감지해 file_changed를 발행한다', async () => {
    // Note: the watcher debounces per-file, so a create can surface as 'add' OR
    // 'change' depending on how the OS coalesces the write (Windows often emits
    // add+change for one write → only the last survives the debounce). We assert
    // detection + a distinct 'unlink', not the exact create event type.
    await watcher.handle(watchRequest(dir, 's1', ['**/*.ts']))
    await waitReady(store, 's1')

    const file = path.join(dir, 'foo.ts')

    // create → detected
    await writeFile(file, 'export const a = 1\n')
    await waitFor(() => capturedChanges(publish).some((c) => c.path.includes('foo.ts')))

    // modify → a further event is emitted (let the create debounce flush first)
    await new Promise((r) => setTimeout(r, 150))
    const beforeModify = capturedChanges(publish).length
    await writeFile(file, 'export const a = 2\n')
    await waitFor(() => capturedChanges(publish).slice(beforeModify).some((c) => c.path.includes('foo.ts')))

    // delete → distinct 'unlink' event
    await rm(file)
    await waitFor(() => capturedChanges(publish).some((c) => c.event === 'unlink' && c.path.includes('foo.ts')))

    expect(capturedChanges(publish).some((c) => c.path.includes('foo.ts'))).toBe(true)
    expect(capturedChanges(publish).some((c) => c.event === 'unlink' && c.path.includes('foo.ts'))).toBe(true)
  }, 40_000)

  it('glob이 실제로 확장/필터된다 — 매칭 확장자만 감지(리터럴 경로 회귀 가드)', async () => {
    await watcher.handle(watchRequest(dir, 's2', ['**/*.ts']))
    await waitReady(store, 's2')

    await writeFile(path.join(dir, 'note.md'), 'not watched\n')
    await writeFile(path.join(dir, 'bar.ts'), 'watched\n')

    // the matching .ts file is detected...
    await waitFor(() => capturedChanges(publish).some((c) => c.path.includes('bar.ts')))
    // ...and the non-matching .md file is NOT (glob filtered, not literal path)
    await new Promise((r) => setTimeout(r, 250))
    expect(capturedChanges(publish).some((c) => c.path.includes('note.md'))).toBe(false)
  }, 40_000)
})
