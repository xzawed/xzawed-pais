# PAIS_PROFILE — 프리미엄 자율 프로필 프리셋 설계

**날짜:** 2026-07-18
**근거:** [Claude⊕Grok 프리미엄 준비도 공동 검증](../../analysis/claude-grok-premium-verification.md) G1(최고 레버리지) — "~30개 `MANAGER_*` 플래그 매트릭스"가 프리미엄 서비스의 최대 EASY 위반. `PAIS_PROFILE` 하나로 검증된 스택을 켜고 JWT/DB를 강제해 고객에게서 플래그 매트릭스를 제거한다.
**SKU 결정:** **B. 자율 팩토리(self-host)** — 첫 프로필은 `autonomous`.

## 문제

자율 Task Graph 아크를 실제로 돌리려면 ~5개(최소)~15개(실용) 상호의존 env를 수동 조립해야 하고, 부분 조립은 (경고는 뜨지만) 무음 stall처럼 보인다. `SERVICE_JWT_SECRET`/`DATABASE_URL` 누락은 개방 mutation·미배선으로 이어진다. 이는 프리미엄 서비스의 EASY·ACCURATE를 정면 위반한다.

## 설계

### 메커니즘 (서비스별 env-merge 레이어)

각 서비스 `config.ts`의 스키마 parse **직전**에 순수 함수 `resolveProfileEnv(env)`를 통과시킨다:

- `PAIS_PROFILE` 미설정/빈 값 → env 그대로 반환(**바이트 동일·회귀 0**).
- 알 수 없는 프로필 이름 → 명확한 에러 throw(`Unknown PAIS_PROFILE: '...'. Known: autonomous`).
- 알려진 프로필 → 프로필 기본값을 env **복사본**에 병합하되 **이미 설정된 개별 env가 우선**(override). 병합본을 반환.

`loadConfig()`는 `parse(resolveProfileEnv(process.env))`로 호출한다. Orchestrator와 Manager는 config를 공유하지 못하므로(Orchestrator는 `@xzawed/agent-streams` 미참조) 각자 소량 구현한다(프로필 테이블은 각 서비스에 자기 플래그만).

### `autonomous` 프로필 내용 (검증된 correctness-floor 스택)

**Manager** (`PROFILES.autonomous`):
| env | 값 | 이유 |
|---|---|---|
| `TASK_MANAGER_ENABLED` | `true` | Supervisor 배선 |
| `MANAGER_DECOMPOSE_ENABLED` | `true` | 분해 생산자 |
| `MANAGER_TASK_WORKER` | `true` | 실행 워커(dispatch→lease→complete 루프 폐합) |
| `MANAGER_WP_VERIFY` | `true` | 실행 ground-truth 검증(fail-closed) |
| `MANAGER_LEASE_VISIBILITY_MS` | `600000` | 검증 다단계 중 false reclaim 방지(기본 300s→600s 바닥) |
| `MANAGER_BUDGET_PER_WORKFLOW_USD` | `5` | **비용 캡 기본-on**(G5 선반영) |
| `MANAGER_BUDGET_DAILY_USD` | `50` | 일 상한 |

**하드 요구**(autonomous인데 없으면 기동 거부·명확한 parse 에러): `SERVICE_JWT_SECRET`(≥32)·`DATABASE_URL`. → G3(프로덕션 auth 하드페일) 일부 선반영.

**Orchestrator** (`PROFILES.autonomous`): `ORCHESTRATOR_DECOMPOSE_ENABLED=true`. (현재 `server.ts`가 process.env를 직접 읽으므로 config로 라우팅하는 소규모 개선 동반.)

### 정직한 미포함 (YAGNI·오약속 방지)

고급 verify 채널(conformance/impact/property/mutation/security)·전체 decision/oracle/risk/release/deploy/degraded 체인은 **명시 opt-in**으로 남긴다. 이들은 사람이 시드한 oracle/golden·risk 승인이 있어야 의미가 있어 기본 on이면 skip되거나 차단된다 — 공동 검증의 "risk 체인 없이 mutation 주장 말라"와 일치. 프로필은 "돌아가고 + 기본 검증"까지만 정직하게 켠다.

### 구현 슬라이스

- **슬라이스 1 (PR 1)**: Manager `resolveProfileEnv` + `PROFILES.autonomous` + superRefine 하드요구 + 단위 테스트 + env 문서.
- **슬라이스 2 (PR 2)**: Orchestrator `ORCHESTRATOR_DECOMPOSE_ENABLED`를 config로 라우팅 + `resolveProfileEnv` + 프로필 + 테스트.

### 테스트 (각 슬라이스)

- 프로필이 미설정 플래그를 기본값으로 채움
- 개별 env가 프로필을 override
- 미지 프로필 → throw
- (Manager) autonomous인데 JWT/DB 누락 → parse 에러 / 둘 다 있으면 통과
- `PAIS_PROFILE` 미설정 → 회귀 0(기존 동작 동일)

## 범위 밖 (후속)

- Launcher가 `PAIS_PROFILE`를 세팅하는 UX(G1 온보딩)
- G2 단일 happy-path UI·G4 정직 Live-vs-Flagged 문서 매트릭스
- 추가 프로필(chat-first 등)·G5 고객 비용 UI·G3 전면 auth 하드페일(remote 무조건)
