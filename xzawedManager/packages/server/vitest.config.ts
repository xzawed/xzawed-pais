import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    pool: process.env.CI === 'true' ? 'vmForks' : 'forks',
    poolOptions: {
      vmForks: {
        maxForks: 1,
        memoryLimit: '1g',
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
