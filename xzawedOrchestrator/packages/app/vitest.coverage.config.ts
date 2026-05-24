import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['import', 'module', 'browser', 'default'],
  },
  test: {
    environment: 'node',
    include: [
      'test/**/*.test.ts',
      'src/renderer/src/lib/parseAgentSteps.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
