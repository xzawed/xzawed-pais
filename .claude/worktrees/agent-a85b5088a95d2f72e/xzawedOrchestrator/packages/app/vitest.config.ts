import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
        resolve: {
          conditions: ['import', 'module', 'browser', 'default'],
        },
      },
      {
        plugins: [react()],
        resolve: {
          conditions: ['import', 'module', 'browser', 'default'],
        },
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          include: ['src/renderer/src/__tests__/**/*.browser.test.tsx'],
          setupFiles: ['./src/renderer/src/__tests__/setup.browser.ts'],
        },
      },
    ],
  },
})
