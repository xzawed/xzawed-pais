import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
