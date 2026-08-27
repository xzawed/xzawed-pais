import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
    // 통합 게이트 관측성 + fail-closed. 없을 때는 인프라 부재가 **경고조차 없이** 조용했다
    // (실측: env 하나로 pg 9건·Redis 7건이 갈렸다). 판정 코어는 Manager와 복제 블록이다.
    globalSetup: ['./test/vitest-global-setup.ts'],
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
