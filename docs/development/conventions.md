# xzawedPAIS 코딩 컨벤션

전 서비스 공통 패턴 정의. 서비스별 예외는 해당 서비스 `CLAUDE.md` 참조.

---

## 파일 책임 원칙

각 파일은 단 하나의 역할만 담당한다.

| 파일 패턴 | 허용 | 금지 |
|-----------|------|------|
| `config.ts` | 환경변수 로드·검증 (Zod) | 비즈니스 로직 |
| `types.ts` | 타입·Zod 스키마 정의 | 런타임 로직 |
| `streams/consumer.ts` | Redis XREADGROUP 소비 | 비즈니스 처리 |
| `streams/producer.ts` | Redis XADD 발행 | 비즈니스 처리 |
| `claude/runner.ts` | Anthropic SDK 호출 | 파일시스템 접근 |
| `executor.ts` | child_process 실행 | Redis 직접 접근 |
| `server.ts` | Fastify 서버 `/health` | 비즈니스 로직 |
| `index.ts` | 서비스 진입점, 컴포넌트 조립 | 비즈니스 로직 |

---

## Redis 메시지 패턴

### 수신 검증 (safeParse)

모든 수신 메시지는 Zod `safeParse`로 검증한다. 실패 시 xack 후 skip.

```typescript
// ✅ 올바름
const result = MessageSchema.safeParse(JSON.parse(raw))
if (!result.success) {
  log.warn({ raw }, 'Invalid message — skipping')
  await xack(...)
  return
}
processMessage(result.data)

// ❌ 금지
const msg = JSON.parse(raw) as MyMessage  // 런타임 타입 보장 없음
```

### xack 보장 (try/finally)

핸들러 예외 시에도 xack를 보장한다. 미실행 시 PEL 누수.

```typescript
// ✅ 올바름
try {
  await handler(msg)
} finally {
  await redis.xack(stream, group, id)
}

// ❌ 금지
await handler(msg)       // 예외 시 xack 미실행
await redis.xack(...)
```

### 발행 (producer.ts 경유)

Redis에 직접 XADD 금지. `producer.ts`를 통해서만 발행.

---

## 에러 타입 변환

원시 `Error` 객체를 Redis에 발행하지 않는다. 서비스 전용 에러 타입으로 변환.

```typescript
// ✅ 올바름
const errors: BuildError[] = [{ message: e.message, suggestion: '' }]
await producer.publish(sessionId, { type: 'build_complete', payload: { errors } })

// ❌ 금지
await producer.publish(sessionId, { error: new Error('failed') })
```

---

## 경로 보안 패턴

### validateWorkspaceRoot

파일 시스템 접근 서비스(Developer, Tester, Builder, Watcher, Security)는 반드시 서비스 시작 시 호출.

```typescript
import { validateWorkspaceRoot } from '@xzawed/agent-streams'
validateWorkspaceRoot(config.workspaceRoot)  // 파일시스템 루트이면 즉시 throw
```

### 경로 검증

LLM 생성 경로는 절대경로를 workspaceRoot 기준 상대경로로 강제.

```typescript
const safePath = path.resolve(workspaceRoot, userPath)
if (!safePath.startsWith(path.resolve(workspaceRoot))) {
  throw new Error(`경로 거부: ${userPath}`)
}
```

### 심볼릭 링크 차단

`fs.realpath`로 심볼릭 링크 우회 탐지.

```typescript
const real = await fs.realpath(safePath)
if (!real.startsWith(path.resolve(workspaceRoot))) {
  throw new Error(`심볼릭 링크 탈출 시도: ${userPath}`)
}
```

---

## TypeScript 규칙

- `strict: true` + `exactOptionalPropertyTypes: true` 필수
- `JSON.parse(x) as Type` 캐스트 금지 — 반드시 `safeParse` 사용
- `noUncheckedIndexedAccess: true` — 배열 인덱싱 결과는 `T | undefined`
- `void asyncFn()` 패턴은 반드시 `.catch()` 체인 필수 (S6544)

---

## 테스트 패턴

- `vitest.config.ts`: `pool: 'forks'` 고정 (프로세스 격리)
- Redis 통합 테스트: `REDIS_URL` 없으면 `test.skip`
- 외부 의존성(child_process, Redis, Anthropic SDK)은 `vi.mock`으로 격리
- `afterEach(cleanup)` — @testing-library/react 사용 시 필수
- `vi.hoisted()` — `vi.mock` 팩토리 내에서 참조할 변수 초기화

---

## 관련 문서

- [보안 패턴 상세](security-patterns.md)
- [SonarCloud 트러블슈팅](sonarcloud.md)
- [기여 가이드](contributing.md)
