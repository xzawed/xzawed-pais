# 코딩 컨벤션

이 문서는 Claude Code가 xzawedBuilder 코드를 작성할 때 따르는 규칙이다.

## 파일 책임 원칙

각 파일은 하나의 역할만 담당한다.

| 파일 | 허용 | 금지 |
|---|---|---|
| `detector.ts` | 빌드 명령 감지 | child_process 실행, Redis 접근 |
| `executor.ts` | child_process 실행 + 스트리밍 | Redis 발행 |
| `builder.ts` | 감지·실행 조율 | 직접 Redis 접근 |
| `streams/producer.ts` | Redis 메시지 발행 | 빌드 로직 |
| `claude/runner.ts` | Anthropic SDK 호출 | 파일시스템 접근 |

## 에러 처리 규칙

빌드 실패는 반드시 `BuildError` 타입으로 변환해 발행한다. 원시 `Error` 객체를 Redis에 직접 발행하지 않는다.

```typescript
// ✅ 올바름
const errors: BuildError[] = [
  { file: 'src/index.ts', line: 12, message: e.message, suggestion: 'Claude 분석 전 초기값 — runner.ts에서 채워짐' }
]

// ❌ 금지
producer.publish({ error: new Error('build failed') })
```

## Redis 메시지 발행 규칙

`producer.ts`를 통해서만 발행한다. 발행 전 반드시 Zod 스키마로 검증한다.

```typescript
// ✅ 올바름
const validated = BuilderToManagerMessageSchema.parse(message)
await producer.publish(sessionId, validated)

// ❌ 금지
await redis.xadd(stream, '*', 'data', JSON.stringify(rawMessage))
```

## 스트리밍 출력 규칙

`executor.ts`는 stdout/stderr를 청크 단위로 수신하는 즉시 `build_progress` 메시지로 발행한다. 전체 출력을 버퍼에 쌓아 한 번에 발행하지 않는다.

```typescript
// ✅ 올바름
proc.stdout.on('data', async (chunk) => {
  await producer.publish(sessionId, { type: 'build_progress', payload: { content: chunk.toString() } })
})

// ❌ 금지
let output = ''
proc.stdout.on('data', (chunk) => { output += chunk })
proc.on('close', () => producer.publish(sessionId, { payload: { output } }))
```

## 경로 보안 규칙

`executor.ts`는 빌드 실행 전 `projectPath`가 `WORKSPACE_ROOT` 하위인지 반드시 검증한다.

```typescript
import path from 'node:path'

if (!path.resolve(projectPath).startsWith(path.resolve(config.workspaceRoot))) {
  throw new Error(`경로 거부: ${projectPath}`)
}
```

## 테스트 기준

| 대상 | 종류 | 위치 |
|---|---|---|
| `detector.ts` | 단위 테스트 (파일시스템 mock) | `src/detector.test.ts` |
| `executor.ts` | 단위 테스트 (child_process mock) | `src/executor.test.ts` |
| `builder.ts` | 단위 테스트 (detector·executor mock) | `src/builder.test.ts` |
| `streams/consumer.ts` | 통합 테스트 (실제 Redis) | `src/streams/consumer.test.ts` |
| `streams/producer.ts` | 통합 테스트 (실제 Redis) | `src/streams/producer.test.ts` |
