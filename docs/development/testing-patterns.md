# 테스트 패턴 가이드

xzawedPAIS에서 발생했던 실제 문제를 기반으로 정리한 테스트 작성 패턴.

## Redis Consumer Mock 패턴

### 문제: 마이크로태스크 기아 (OOM 원인)

`xreadgroup`이 즉시 resolve하면 이벤트 루프 macrotask 큐를 영구 차단한다.
Consumer 루프가 `stop()` 신호를 받지 못해 무한 실행 → OOM.

```typescript
// ❌ 잘못된 패턴
function makeRedis() {
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockResolvedValue(null), // 즉시 resolve → macrotask 차단
    xack: vi.fn().mockResolvedValue(1),
  }
}

// ✅ 올바른 패턴
function makeRedis(responses: unknown[][] = []) {
  let call = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockImplementation(() => {
      if (call >= responses.length) {
        // XREADGROUP BLOCK 동작 재현 — macrotask로 양보
        return new Promise<null>(r => setImmediate(() => r(null)))
      }
      return Promise.resolve(responses[call++])
    }),
    xack: vi.fn().mockResolvedValue(1),
  }
}
```

**왜 setImmediate인가?**
- `Promise.resolve(null)` → 마이크로태스크 큐 → `setTimeout(r, 50)` 실행 불가
- `setImmediate(() => r(null))` → macrotask 큐 → `setTimeout(r, 50)` 실행 가능
- 실제 ioredis는 2초 BLOCK 후 null 반환 → 자연스럽게 이벤트 루프 양보

### Consumer 테스트 기본 구조

```typescript
it('메시지를 처리한다', async () => {
  const mockRedis = makeRedis([
    [['stream:key', [['1-0', ['data', JSON.stringify(message)]]]]]
  ])
  vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)

  const consumer = new MyConsumer('redis://localhost:6379', handler)

  const p = consumer.start()
  await new Promise(r => setTimeout(r, 50)) // 처리 대기
  consumer.stop()
  await p                                   // 정상 종료 확인

  expect(handler).toHaveBeenCalledWith(...)
})
```

**핵심**: `stop()` 후 `await p`로 Consumer가 정상 종료됨을 반드시 검증한다.

## ioredis 클라이언트 설정

테스트 환경에서 ioredis 무한 재연결을 방지한다:

```typescript
// redis.client.ts
client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 2000,
  retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined,
})
```

`VITEST` 환경변수는 vitest 실행 시 자동으로 `'true'`로 설정되므로 별도 관리 불필요.

## vitest Shard Coverage 병합

CI가 현재 쓰는 방법 — shard별로 리포트 디렉토리를 분리해 실행한 뒤 lcov를 직접 이어붙인다.

```bash
# 각 shard 실행 (--coverage.reportsDirectory로 분리)
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-1 --shard=1/2
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-2 --shard=2/2

# lcov 파일 병합
mkdir -p coverage
cat coverage/shard-*/lcov.info > coverage/lcov.info
```

> 이 우회는 `vitest merge-coverage` 서브커맨드가 없던 **vitest 3.x 시절 전제**에서 나왔다. 저장소는 이제 vitest 4.1.x이고 `--mergeReports <blob-dir>`가 존재한다(`npx vitest --help`로 확인). blob 리포트 경로로 대체 가능한지는 **미검증** — 교체하려면 lcov 산출까지 실측한 뒤에 한다.

**주의**: `vitest merge-coverage` 또는 `vitest --mergeReports`는 blob reporter 전용이며
istanbul lcov 병합에는 단순 concatenation이 더 안정적이다.

## Mock 의존성 경로 확인

`vi.mock()` 경로는 **테스트 파일 기준 상대경로**가 아니라
**mock 대상 모듈의 위치**에서 import할 때와 동일한 경로여야 한다.

```typescript
// 테스트 파일: src/streams/session-gateway.test.ts
// 대상 파일: src/streams/session-gateway.ts (redis.client.js를 import)

// ❌ 잘못된 경로 (테스트 파일 기준)
vi.mock('../streams/redis.client.js', ...)

// ✅ 올바른 경로 (대상 모듈의 import 경로와 동일)
vi.mock('./redis.client.js', ...)
```

---

### E2E 선택자 규칙 (i18n 환경)

i18n 적용 후 텍스트 기반 선택자는 로케일 변경 시 깨진다. **`data-testid` 전용 사용 필수**.

```typescript
// ❌ 로케일 변경 시 깨짐
await page.getByText('설정 저장').click()

// ✅ 로케일 무관
await page.getByTestId('settings-save').click()
```

Page Object Model(POM): `packages/app/e2e/pages/` 참고.

### E2E Electron 한계 및 대응 패턴

Playwright E2E에서 Electron 특유의 제약이 있다. 확인된 패턴:

**IPC mock — `electronApp.evaluate()` 금지**: nav 클릭 등 UI 인터랙션 이후 `electronApp.evaluate()`로 ipcMain 핸들러를 교체하면 Electron 내부 nav 이벤트 큐가 블로킹되는 부작용이 있다. 대신 test 모드에서 `main.tsx`가 `window.__integrationsStore`를 노출하므로 `page.evaluate()`로 직접 상태를 주입한다:
```typescript
// ❌ electronApp.evaluate() — nav 클릭 후 블로킹 부작용 발생
await electronApp.evaluate(({ ipcMain }) => {
  ipcMain.removeHandler('github:get-status')
  ipcMain.handle('github:get-status', () => ({ connected: true, username: 'test' }))
})

// ✅ window.__integrationsStore 직접 주입 (test 모드 전용)
await page.evaluate(() => {
  window.__integrationsStore?.setState({ github: { connected: true, username: 'test' } })
})
```

**locale 선주입 (CI 대응)**: `page.reload()` 전에 `page.addInitScript()`로 localStorage에 locale을 선주입해야 CI에서 로케일이 초기화 타이밍 문제로 어긋나지 않는다:
```typescript
await page.addInitScript(() => {
  localStorage.setItem('locale', 'en')
})
await page.reload()
await page.waitForSelector('[data-i18n-ready]')
```

**i18n 초기화 완료 대기**: `page.reload()` 후 i18n이 재초기화될 때까지 대기 필요:
```typescript
await page.reload()
await page.waitForSelector('[data-i18n-ready]') // i18n.ts init 완료 시 설정되는 속성
```

**WebSocket mock 불가**: `page.route()`는 HTTP만 intercept하며 `ws://` 차단 불가. 에러 상태 시뮬레이션은 HTTP 엔드포인트 mock으로 대체:
```typescript
// ❌ ws:// 차단 불가
await page.route('**/ws/**', route => route.abort())

// ✅ HTTP 오류로 에러 경로 테스트
await page.route('**/sessions/*/messages', route => route.fulfill({ status: 500 }))
```

**MemoryRouter + reload**: Electron 앱은 BrowserRouter 대신 MemoryRouter를 사용해 `page.waitForURL()`이 동작하지 않음. DOM testid나 `waitFor({ state: 'visible' })`로 네비게이션 완료 확인:
```typescript
await element.waitFor({ state: 'visible', timeout: 10_000 })
```

**i18n 대기 — `waitForI18n` fixture 사용**: `fixtures.ts`의 `waitForI18n` fixture로 `[data-i18n-ready]` 대기를 추상화:
```typescript
// ❌ 중복
await page.waitForSelector('[data-i18n-ready]', { timeout: 10_000 })

// ✅ fixture 사용
test('...', async ({ page, waitForI18n }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'))
  await page.reload()
  await waitForI18n()
})
```

**POM 클래스 패턴**: `PluginPanel`·`SettingsModal` 모두 `open()`/`close()` 메서드를 제공한다. 새 패널 POM 추가 시 동일 패턴 적용:
```typescript
async open(): Promise<void> {
  await this.navButton.click()
  await this.panel.waitFor({ state: 'visible' })
}
```

**`.count()`는 auto-wait가 없다**: 즉시 스냅샷을 찍으므로 렌더 전에 0을 읽는다. 열린 Dependabot PR 15건을 전부 red로 만든 CI 상시 실패의 원인이었다(#513). 재시도가 걸리는 web-first 단언을 쓴다:
```typescript
// ❌ 렌더 타이밍에 따라 간헐 실패
const count = await page.getByTestId('session-list-item').count()
expect(count).toBeGreaterThanOrEqual(1)

// ✅ expect가 재시도
await expect(page.getByTestId('session-list-item')).not.toHaveCount(0)
```
직전에 `await expect(...).toBeVisible()`로 선행 대기를 걸었다면 `.count()`도 안전하다(`streaming.spec.ts`). `e2e/operational/`에 미수정 6곳이 남아 있다 — CI 필수 잡이 아니라 방치 중.

