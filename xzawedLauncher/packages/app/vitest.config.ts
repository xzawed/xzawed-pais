import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/main/**/*.test.ts', 'test/renderer/**/*.test.ts'],
    pool: 'forks',
  },
})
