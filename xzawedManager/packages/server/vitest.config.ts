import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
