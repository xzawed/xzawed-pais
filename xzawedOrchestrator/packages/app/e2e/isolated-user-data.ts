import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * E2E 가 띄우는 Electron 에 **전용 userData 디렉토리**를 준다.
 *
 * 두 가지를 동시에 해결한다.
 *
 * 1. **단일 인스턴스 잠금과의 충돌.** `main/index.ts` 가 `requestSingleInstanceLock()` 을
 *    쓰는데, 그 락은 userData 경로 단위다. 격리하지 않으면 개발자가 Orchestrator 앱을
 *    열어 둔 채 `pnpm test:e2e` 를 돌릴 때 **모든 launch 가 즉시 quit** 되어
 *    `firstWindow()` 가 타임아웃한다. CI 는 컨테이너라 무사하지만 로컬은 아니다.
 * 2. **개발자 상태 오염.** 격리 전에는 E2E 가 개발자의 실제 `settings.json`·
 *    `mcp-servers.json` 을 읽고 썼다. 테스트가 로컬 설정에 따라 달라지고, 반대로
 *    테스트가 로컬 설정을 망가뜨릴 수 있었다.
 */
export interface IsolatedLaunch {
  /** `electron.launch({ args })` 에 그대로 넘긴다. */
  args: string[]
  /** 앱을 닫은 뒤 호출한다. 실패해도 던지지 않는다(테스트를 깨뜨리지 않는다). */
  cleanup: () => void
}

export function isolatedUserData(mainEntry: string): IsolatedLaunch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xzawed-e2e-'))
  return {
    args: [mainEntry, `--user-data-dir=${dir}`],
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // 정리 실패는 테스트 결과가 아니다. OS 임시 디렉토리가 결국 회수한다.
      }
    },
  }
}
