import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    // 통합 테스트 DB 게이트 관측성: DATABASE_URL 부재 시 skip을 1회 경고(테스트 동작 불변).
    globalSetup: ['./test/vitest-global-setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: process.env.CI === 'true' ? 1 : undefined,
      },
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov', 'json'],
      include: ['src/**/*.ts'],
    },
  },
})
