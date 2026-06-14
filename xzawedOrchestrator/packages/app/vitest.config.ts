import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  // esbuild 0.28+ dropped legacy syntax lowering; pin a modern target so the vite6
  // default (chrome87/es2020) lowering path is not taken in source transform and
  // dep pre-bundling (GHSA-gv7w-rqvm-qjhr fix).
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
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
        esbuild: { target: 'es2022' },
        optimizeDeps: { esbuildOptions: { target: 'es2022' } },
        resolve: {
          conditions: ['import', 'module', 'browser', 'default'],
        },
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            provider: playwright(),
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
