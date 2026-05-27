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

vitest 3.x에서 shard별 coverage를 병합하는 올바른 방법:

```bash
# 각 shard 실행 (--coverage.reportsDirectory로 분리)
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-1 --shard=1/2
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-2 --shard=2/2

# lcov 파일 병합 (vitest merge-coverage는 vitest 3.x에 없음)
mkdir -p coverage
cat coverage/shard-*/lcov.info > coverage/lcov.info
```

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
