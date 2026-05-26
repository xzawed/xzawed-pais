import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    pool: process.env.CI === 'true' ? 'vmForks' : 'forks',
    poolOptions: {
      vmForks: {
        maxForks: 1,
        memoryLimit: '800m',
        execArgv: ['--max-old-space-size=2048'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
