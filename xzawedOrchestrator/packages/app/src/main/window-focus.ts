/**
 * "기존 창 되살리기" — `second-instance` 에서 쓴다.
 *
 * `BrowserWindow` 를 직접 받지 않고 필요한 메서드만 구조적으로 요구한다.
 * `main/index.ts` 는 모듈 최상위에서 `ipcMain.handle` 을 20여 개 등록하는 부작용
 * 모듈이라 통째로 import 하는 테스트가 비싸다. 실제 분기를 여기로 빼면
 * electron mock 없이 `test/main/window-focus.test.ts` 로 고정할 수 있다.
 */
export interface RestorableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * 되살릴 창이 있으면 복원·표시·포커스하고 `true` 를 반환한다.
 * 창이 없거나 이미 파괴됐으면 아무것도 하지 않고 `false` 를 반환한다 —
 * 새 창을 만들지는 호출자가 판단한다.
 *
 * `mainWindow` 는 창이 닫혀도 `null` 로 되돌아가지 않는다(`createWindow` 에서만
 * 대입된다). 그래서 null 검사만으로는 부족하고 `isDestroyed()` 를 함께 봐야 한다.
 * 그리고 최소화된 창은 `show()` 만으로 복원되지 않으므로 `restore()` 가 먼저다.
 */
export function focusExistingWindow(win: RestorableWindow | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return true
}
