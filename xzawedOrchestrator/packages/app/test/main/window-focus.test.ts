import { describe, it, expect, vi } from 'vitest'
import { focusExistingWindow } from '../../src/main/window-focus.js'

/**
 * `second-instance` 가 기존 창을 되살리는 분기.
 *
 * `main/index.ts` 는 모듈 최상위에서 `ipcMain.handle` 을 20여 개 등록하는 부작용
 * 모듈이라 통째로 import 하는 테스트가 비싸다. 실제 분기(최소화·파괴·부재)만
 * 떼어 두면 electron mock 없이 고정할 수 있다.
 */

function fakeWindow(state: { destroyed?: boolean; minimized?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => state.destroyed ?? false),
    isMinimized: vi.fn(() => state.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
}

describe('focusExistingWindow', () => {
  it('창이 없으면 false — 호출자가 새 창을 만들어야 한다', () => {
    expect(focusExistingWindow(null)).toBe(false)
    expect(focusExistingWindow(undefined)).toBe(false)
  })

  it('파괴된 창은 건드리지 않고 false', () => {
    // `mainWindow` 는 창이 닫혀도 null 로 되돌아가지 않는다(createWindow 에서만 대입된다).
    // null 검사만으로는 부족하고 isDestroyed() 를 함께 봐야 한다.
    const win = fakeWindow({ destroyed: true })
    expect(focusExistingWindow(win)).toBe(false)
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
    expect(win.restore).not.toHaveBeenCalled()
  })

  it('최소화된 창은 restore 후 show·focus 한다', () => {
    // 트레이로 내려가 있거나 최소화된 상태에서 두 번째 실행이 오는 것이 흔한 경로다.
    // show() 만으로는 최소화가 풀리지 않는다.
    const win = fakeWindow({ minimized: true })
    expect(focusExistingWindow(win)).toBe(true)
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('최소화되지 않은 창은 restore 없이 show·focus 한다', () => {
    const win = fakeWindow()
    expect(focusExistingWindow(win)).toBe(true)
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })
})
