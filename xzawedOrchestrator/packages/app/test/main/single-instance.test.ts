import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * **단일 인스턴스 잠금의 분기 자체를 고정한다.**
 *
 * `focusExistingWindow` 는 창을 되살리는 쪽만 검사한다. 정작 중요한 것은
 * "락을 못 얻으면 **아무것도 시작하지 않는다**"인데, 그 판정은 `main/index.ts`
 * 모듈 최상위에 있다. 부작용 모듈이라 import 자체가 실행이므로 electron 과
 * 형제 모듈을 전부 mock 하고 동적 import 한다.
 *
 * `whenReady` 를 영원히 pending 인 Promise 로 두는 것이 핵심이다 — resolve 시키면
 * 서버 spawn·MCP 기동·창 생성이 실제로 돌아간다.
 */

const electronMock = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    setName: vi.fn(),
    getPath: vi.fn(() => '/tmp/test-userData'),
    requestSingleInstanceLock: vi.fn(() => true),
    isReady: vi.fn(() => false),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => { /* 영원히 pending */ })),
  },
}))

vi.mock('electron', () => ({ // NOSONAR
  app: electronMock.app,
  BrowserWindow: vi.fn(function () { return {} }),
  ipcMain: { handle: vi.fn() },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
}))
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
}))
vi.mock('../../src/main/server-manager.js', () => ({
  ServerManager: vi.fn(function () { return { start: vi.fn(), stop: vi.fn() } }),
}))
vi.mock('../../src/main/mcp-process-manager.js', () => ({
  McpProcessManager: vi.fn(function () { return { startAutoStart: vi.fn(), stopAll: vi.fn() } }),
}))
vi.mock('../../src/main/plugin-manager.js', () => ({
  PluginManager: vi.fn(function () { return { list: vi.fn(), install: vi.fn(), uninstall: vi.fn() } }),
}))
vi.mock('../../src/main/github-oauth-handler.js', () => ({
  startOAuthFlow: vi.fn(), getStoredToken: vi.fn(), clearToken: vi.fn(),
  fetchGitHubUser: vi.fn(), fetchUserRepos: vi.fn(),
}))
vi.mock('../../src/main/token-storage-main.js', () => ({
  readToken: vi.fn(), writeToken: vi.fn(), readRefreshToken: vi.fn(),
  writeRefreshToken: vi.fn(), clearTokenFiles: vi.fn(),
}))

describe('main/index — 단일 인스턴스 잠금', () => {
  beforeEach(() => {
    // 모듈 최상위 코드는 1회만 실행된다. 케이스마다 리셋이 필수다.
    vi.resetModules()
    vi.clearAllMocks()
    electronMock.app.whenReady.mockImplementation(() => new Promise<void>(() => { /* pending */ }))
  })

  it('락을 얻지 못하면 quit 하고 그 뒤 어떤 초기화도 하지 않는다', async () => {
    electronMock.app.requestSingleInstanceLock.mockReturnValue(false)
    await import('../../src/main/index.js')

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1)
    expect(electronMock.app.whenReady).not.toHaveBeenCalled()
    // 진 인스턴스가 before-quit 을 달면, 훗날 ServerManager.stop() 이 포트·PID
    // 기반으로 바뀌는 순간 이긴 인스턴스의 서버를 죽이는 경로가 열린다.
    const events = electronMock.app.on.mock.calls.map((c) => c[0])
    expect(events).not.toContain('second-instance')
    expect(events).not.toContain('before-quit')
    expect(events).not.toContain('window-all-closed')
  })

  it('락을 얻으면 second-instance·before-quit·window-all-closed 를 등록하고 진행한다', async () => {
    electronMock.app.requestSingleInstanceLock.mockReturnValue(true)
    await import('../../src/main/index.js')

    expect(electronMock.app.quit).not.toHaveBeenCalled()
    expect(electronMock.app.whenReady).toHaveBeenCalledTimes(1)
    const events = electronMock.app.on.mock.calls.map((c) => c[0])
    expect(events).toContain('second-instance')
    expect(events).toContain('before-quit')
    expect(events).toContain('window-all-closed')
  })

  it('requestSingleInstanceLock 은 whenReady 보다 먼저 호출된다', async () => {
    // 창·서버 자식·MCP 자식이 만들어지기 전에 승패가 갈려야 한다.
    const order: string[] = []
    electronMock.app.requestSingleInstanceLock.mockImplementation(() => {
      order.push('lock'); return true
    })
    electronMock.app.whenReady.mockImplementation(() => {
      order.push('whenReady'); return new Promise<void>(() => { /* pending */ })
    })
    await import('../../src/main/index.js')

    expect(order).toEqual(['lock', 'whenReady'])
  })
})
