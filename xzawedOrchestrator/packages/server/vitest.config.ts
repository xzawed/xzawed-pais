import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    pool: 'forks',
    // 소스 테스트만 실행 — 컴파일된 dist 테스트는 제외(중복 실행·dist 리소스 누락 방지)
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // vitest 4: poolOptions 제거 → 워커 수는 top-level maxWorkers로 제어
    maxWorkers: process.env.CI === 'true' ? 1 : undefined,
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov', 'json'],
      include: ['src/**/*.ts'],
    },
  },
})
