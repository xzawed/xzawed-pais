import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
