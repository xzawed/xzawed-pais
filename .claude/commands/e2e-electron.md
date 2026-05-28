---
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git diff:*), Bash(git branch:*)
description: Electron E2E 스펙 작성 가이드 — 금지 패턴 자동 감지 및 올바른 패턴으로 수정
---

## Context

- E2E 스펙 디렉토리: !`ls d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/e2e/specs/`
- 최근 변경된 E2E 파일: !`git diff --name-only origin/master...HEAD -- "xzawedOrchestrator/packages/app/e2e/**"`
- POM 디렉토리: xzawedOrchestrator/packages/app/e2e/pages/

## Your task

이 스킬은 두 가지 모드로 동작한다:

**모드 A — 기존 파일 감사**: 사용자가 특정 파일 경로를 지정하거나 지정하지 않으면 변경된 E2E 파일 전체를 감사하고 금지 패턴을 수정한다.

**모드 B — 신규 스펙 작성 가이드**: 사용자가 "새 스펙 작성" 또는 기능명을 언급하면 올바른 템플릿을 제공한다.

---

### 금지 패턴 감지 및 수정 규칙

다음 패턴을 `xzawedOrchestrator/packages/app/e2e/` 하위 전체 `.ts` 파일에서 탐색한다.

#### 규칙 1: getByText → getByTestId

```typescript
// ❌ 금지: 로케일 변경 시 깨짐
page.getByText('설정 저장')
page.getByText('New Session')

// ✅ 올바른 패턴
page.getByTestId('settings-save')
page.getByTestId('new-session-button')
```

기존 data-testid 목록 (fixtures.ts + POM 파일 기준):
- `nav-chat`, `nav-github`, `nav-mcp`, `nav-plugins`
- `new-session-button`, `empty-chat-message`
- `message-input`, `message-send-button`, `chat-message-list`
- `github-panel`, `github-connect-hint`
- `mcp-panel`, `plugin-panel`
- `settings-modal`, `command-palette`
- `streaming-indicator`, `agent-timeline-card`, `pipeline-strip`

새 testid가 필요하면 해당 컴포넌트(`src/renderer/src/components/`)에 `data-testid` 속성을 추가해야 함을 알린다.

#### 규칙 2: electronApp.evaluate → page.evaluate + __integrationsStore

```typescript
// ❌ 금지: nav 클릭 후 ipcMain 핸들러 교체 시 블로킹 부작용
await electronApp.evaluate(({ ipcMain }) => {
  ipcMain.removeHandler('github:get-status')
  ipcMain.handle('github:get-status', () => ({ connected: true }))
})

// ✅ 올바른 패턴: window.__integrationsStore 직접 주입 (test 모드 전용)
await page.evaluate(() => {
  window.__integrationsStore?.setState({
    github: { connected: true, username: 'test-user' }
  })
})
```

`integrations.store.ts`의 상태 구조: `{ github: { connected, username }, mcp: {...}, plugins: [...] }`

#### 규칙 3: ws:// route → HTTP 엔드포인트 mock

```typescript
// ❌ 금지: ws:// 차단 불가 (page.route는 HTTP만 intercept)
await page.route('**/ws/**', route => route.abort())

// ✅ 올바른 패턴: HTTP 엔드포인트로 에러 경로 테스트
await page.route('**/sessions/*/messages', route => route.fulfill({ status: 500 }))
await page.route('**/health', route => route.fulfill({ status: 503, body: '{}' }))
```

`e2e/helpers/mock-server.ts`의 기존 mock 헬퍼를 우선 활용한다.

#### 규칙 4: page.waitForURL → waitFor({ state: 'visible' })

```typescript
// ❌ 금지: MemoryRouter 환경에서 URL 변경 없음
await page.waitForURL('**/chat')

// ✅ 올바른 패턴: DOM 상태로 네비게이션 완료 확인
await page.getByTestId('chat-message-list').waitFor({ state: 'visible', timeout: 10_000 })
```

#### 규칙 5: locale 선주입 + i18n ready 대기

locale 전환이 필요한 테스트에는 반드시 다음 패턴을 사용한다:

```typescript
// locale 선주입 (CI 대응 — addInitScript가 reload보다 먼저 실행됨)
await page.addInitScript(() => {
  localStorage.setItem('locale', 'en')
})
await page.reload()

// i18n 초기화 완료 대기 (i18n.ts init 완료 시 document.documentElement에 설정)
await page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 })
```

---

### 신규 스펙 파일 템플릿

새 스펙 파일을 `e2e/specs/<카테고리>/<기능명>.spec.ts`에 생성할 때 사용하는 표준 구조:

```typescript
import { test, expect } from '../../fixtures'
import { ChatPage } from '../../pages/ChatPage'
// 필요한 POM import 추가

test.describe('<기능명>', () => {
  test.beforeEach(async ({ page }) => {
    // i18n 준비 대기 (locale 전환 불필요 시 생략 가능)
    await page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 })
  })

  test('<테스트 설명>', async ({ page }) => {
    const chatPage = new ChatPage(page)

    // 1. 상태 주입 (필요 시)
    await page.evaluate(() => {
      window.__integrationsStore?.setState({
        github: { connected: true, username: 'test' }
      })
    })

    // 2. 액션 (data-testid 전용)
    await page.getByTestId('nav-chat').click()
    await chatPage.newSessionButton.waitFor({ state: 'visible', timeout: 10_000 })

    // 3. 검증
    await expect(page.getByTestId('empty-chat-message')).toBeVisible()
  })

  test('에러 상태 시뮬레이션', async ({ page }) => {
    // HTTP 엔드포인트로 에러 경로 테스트
    await page.route('**/sessions', route =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) })
    )

    // ...액션 및 검증
  })
})
```

---

### 실행 방법

1. 금지 패턴을 발견하면 해당 파일을 `Edit` 도구로 직접 수정하고 수정 내역을 요약한다.
2. data-testid가 아직 없는 컴포넌트가 필요하면 컴포넌트 파일도 함께 수정한다.
3. 수정 완료 후 `xzawedOrchestrator/packages/app`에서 `pnpm test:e2e` 실행을 권장한다.
