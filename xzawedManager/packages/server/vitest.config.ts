import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: process.env.CI === 'true' ? 1 : undefined,
        forkOptions: process.env.CI === 'true' ? {
          execArgv: ['--max-old-space-size=512'],
        } : undefined,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
