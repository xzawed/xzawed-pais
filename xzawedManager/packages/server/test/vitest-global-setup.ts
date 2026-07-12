// vitest globalSetup — 통합 테스트 DB 게이트 관측성.
//
// *.integration.test.ts(현재 29개)는 `TEST_DATABASE_URL ?? DATABASE_URL` 부재 시
// `describe.skipIf(!url)`로 **조용히** 건너뛴다(pg 통합 커버리지 증발). 로컬에서 DB 없이
// `pnpm test`를 돌리면 통과처럼 보이지만 실제로는 통합 검증이 실행되지 않은 것이라, 이를
// 사일런트하지 않도록 전체 실행당 1회 경고한다(테스트 동작·게이트 자체는 불변).
//
// CI(turborepo 잡·pg 서비스 컨테이너)는 TEST_DATABASE_URL을 주입하므로 경고가 뜨지 않는다.
export default function (): void {
  const hasDb = Boolean(process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'])
  if (!hasDb) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n[vitest] ⚠ TEST_DATABASE_URL/DATABASE_URL 미설정 — pg 통합 테스트(*.integration.test.ts)가 skip됩니다(커버리지 제외).\n' +
        '         통합 검증은 CI(turborepo 잡) 또는 로컬에서 DATABASE_URL 설정 후 실행하세요.\n',
    )
  }
}
