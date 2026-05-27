# ADR-002: CI/CD 안정성 패턴

**날짜**: 2026-05-27  
**상태**: 채택

## 컨텍스트

Turborepo 기반 두 서비스(xzawedOrchestrator, xzawedManager)의 CI에서 OOM(Out-of-Memory) 장애가 반복 발생.
vitest `pool: 'forks'` + 커버리지 수집 + Redis Consumer 무한루프가 복합 작용.

증상:
- `Reached heap limit Allocation failed - JavaScript heap out of memory`
- 타임아웃 없이 테스트가 무한 실행 → CI job 강제 종료
- V8 커버리지 수집 중 메모리 급증

## 결정

### 1. 테스트 Shard 분할 + Istanbul Coverage

**채택**: `--shard=1/2`, `--shard=2/2` + `@vitest/coverage-istanbul`  
**기각**: V8 coverage (메모리 오버헤드 과다)  
**기각**: 단일 실행 (GitHub Actions 기본 메모리 제한 내 불가)

```yaml
- name: Test (shard 1/2)
  run: pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-1 --shard=1/2

- name: Test (shard 2/2)
  run: pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-2 --shard=2/2
```

Istanbul은 소스맵 기반 계측으로 V8 대비 메모리 소비가 적으며, lcov 포맷 출력을 네이티브 지원한다.

### 2. lcov 병합: cat 명령

**채택**: `cat coverage/shard-*/lcov.info > coverage/lcov.info`  
**기각**: `vitest merge-coverage` — vitest 3.x에 존재하지 않는 서브커맨드  
**기각**: `vitest --mergeReports` — blob reporter 전용, lcov 미지원

```yaml
- name: Merge coverage
  run: mkdir -p coverage && cat coverage/shard-*/lcov.info > coverage/lcov.info
```

lcov 포맷은 동일 파일의 복수 SF 레코드를 SonarCloud 및 genhtml이 올바르게 합산한다.
shard 간 0-hit 중복 레코드도 합산 시 정확도에 영향 없다.

### 3. Redis Consumer mock: setImmediate 패턴

**채택**: `new Promise<null>(r => setImmediate(() => r(null)))`  
**기각**: `Promise.resolve(null)` — 마이크로태스크 큐에서 즉시 resolve → macrotask 양보 없음 → Consumer 루프가 CPU를 독점하여 OOM 유발

실제 XREADGROUP BLOCK 2000은 2초 대기 후 null 반환하며 이벤트 루프를 자연 양보한다.
테스트에서 이 양보 특성을 `setImmediate`로 재현한다.

```typescript
// Consumer xreadgroup mock 표준 패턴
xreadgroup: vi.fn().mockImplementation(() =>
  responses.length
    ? Promise.resolve(responses.shift())
    : new Promise<null>(r => setImmediate(() => r(null)))
)
```

### 4. ioredis retryStrategy 테스트 환경 비활성화

```typescript
retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined
```

VITEST 환경변수는 vitest 실행 시 자동 설정된다.
테스트 환경에서 retryStrategy를 비활성화하지 않으면 연결 실패 시 재시도 루프가 테스트 종료를 막는다.

### 5. 전이 의존성 취약점: pnpm overrides

`pnpm audit`이 감지하지만 `pnpm update`로 해결 불가한 전이 취약점에는
루트 `package.json`의 `pnpm.overrides`를 사용한다.

```json
{
  "pnpm": {
    "overrides": {
      "취약한-패키지": ">=안전한-버전"
    }
  }
}
```

overrides 추가 후 반드시 `pnpm install`을 실행하여 lock 파일을 갱신한다.

## 근거

- Shard 분할은 각 job의 최대 메모리 사용량을 선형으로 감소시킨다
- Istanbul은 V8 대비 커버리지 수집 메모리 오버헤드가 낮다
- `cat` 병합은 외부 도구 불필요하며 lcov 포맷 규격상 복수 SF 합산이 보장된다
- setImmediate 패턴은 실제 BLOCK 동작의 이벤트 루프 양보를 테스트에서 충실히 재현한다

## 결과

**긍정적**:
- CI OOM 완전 해소 (143/143 테스트 통과)
- `pnpm audit` 통과 (취약점 0개)
- 패턴이 문서화되어 신규 Consumer 작성 시 참조 가능

**주의점**:
- shard 분할 시 테스트 파일 수가 매우 적으면 shard 불균형 발생 가능
- lcov concatenation은 같은 파일이 양쪽 shard에 0-hit로 등장해도 합산 정확
- pnpm overrides는 lock 파일 업데이트(`pnpm install`)가 필수
- `vitest merge-coverage` 또는 `--mergeReports` 사용 시도 → 즉시 이 ADR 재확인
