/**
 * dependency-cruiser 설정 — M3 불변식(senario 사양) 강제.
 *
 * M3: "에이전트 간 통신은 Event Bus 메시지 패싱(Redis Streams)만. 서비스끼리 직접 import 금지."
 * 유일한 공유 라이브러리는 `@xzawed/agent-streams`(xzawedShared)뿐이다(루트 CLAUDE.md).
 *
 * 이 게이트는 한 서비스가 다른 서비스의 소스를 직접 import하는 것을 CI에서 차단한다.
 * (xzawedShared는 공유 토대이므로 import 허용 — `to` 목록에 미포함.)
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-service-import',
      comment:
        'M3 불변식: 에이전트 서비스끼리 직접 import 금지 — 통신은 Redis Streams. 공유는 @xzawed/agent-streams(xzawedShared)만 허용.',
      severity: 'error',
      from: {
        // 모든 xzawed* 디렉터리(서비스 + Shared/Launcher). $1로 출발 디렉터리를 캡처.
        path: '^(xzawed[A-Za-z]+)/',
      },
      to: {
        // 도착 경로에 "에이전트 서비스"(9 + Launcher) 디렉터리가 세그먼트로 등장하면 위반 후보.
        // (^|/) 세그먼트 매칭이라 해석된 경로(xzawedX/...)·미해석 상대경로(../../xzawedX/...) 모두 잡는다.
        // xzawedShared는 목록에 없어 import 허용.
        path: '(?:^|/)(xzawedOrchestrator|xzawedManager|xzawedPlanner|xzawedDeveloper|xzawedDesigner|xzawedTester|xzawedBuilder|xzawedWatcher|xzawedSecurity|xzawedLauncher)/',
        // 같은 서비스 내부 import는 허용($1 = 출발 서비스 디렉터리).
        pathNot: '(?:^|/)$1/',
      },
    },
  ],
  options: {
    doNotFollow: { path: '(node_modules|dist|out)' },
    exclude: String.raw`(node_modules|/dist/|/out/|\.test\.|\.spec\.|/__tests__/|/test/|/e2e/|/coverage/)`,
    // 타입 전용 import(컴파일 시 사라지는)도 경계 위반으로 잡는다.
    tsPreCompilationDeps: true,
  },
}
