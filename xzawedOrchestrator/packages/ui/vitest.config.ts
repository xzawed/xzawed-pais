import { defineConfig } from 'vitest/config'

export default defineConfig({
  // esbuild 0.28+ dropped legacy syntax lowering; pin a modern target so the vite6
  // default (chrome87/es2020) lowering path is not taken (GHSA-gv7w-rqvm-qjhr fix).
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  test: {
    environment: 'jsdom',
    isolate: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov'],
    },
  },
})
