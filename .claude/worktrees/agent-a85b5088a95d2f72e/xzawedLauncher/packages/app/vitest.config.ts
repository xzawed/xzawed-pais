import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['test/main/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['test/renderer/**/*.test.ts'],
        },
      },
    ],
  },
})
