import { vi } from 'vitest'

export function makeSpawnResult(stdout: string, exitCode = 0) {
  const stdoutHandlers: ((d: Buffer) => void)[] = []
  const closeHandlers: ((code: number) => void)[] = []
  const proc = {
    stdout: { on: vi.fn((event: string, cb: (d: Buffer) => void) => { if (event === 'data') stdoutHandlers.push(cb) }) },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: ((code: number) => void) | ((e: Error) => void)) => {
      if (event === 'close') closeHandlers.push(cb as (code: number) => void)
    }),
  }
  setTimeout(() => {
    stdoutHandlers.forEach((h) => h(Buffer.from(stdout)))
    closeHandlers.forEach((h) => h(exitCode))
  }, 0)
  return proc
}
