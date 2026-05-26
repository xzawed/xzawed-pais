import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: process.env.CI === 'true' ? 1 : undefined,
        execArgv: process.env.CI === 'true' ? ['--max-old-space-size=1024'] : [],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
