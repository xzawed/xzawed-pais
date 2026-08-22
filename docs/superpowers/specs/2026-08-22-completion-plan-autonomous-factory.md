# 완성 실행계획 — 자율 검증 소프트웨어 팩토리

**완성의 기준을 "자율 팩토리"로 고정한 SDD + WBS + TDD 계획.** 조사 5면 · 적대적 반증 3렌즈 · Grok 독립 검증으로 만들었고, 결론을 지탱하는 사실은 전부 `파일:줄`로 재대조했다.

> **이 문서는 로드맵이 아니다.** [roadmap.md](../../development/roadmap.md)는 "지금 어디까지 왔고 다음에 무엇을 하는가"이고, 이 문서는 "완성을 어떻게 정의하고 어떤 순서로 닫는가"다. 둘이 어긋나는 지점은 §8에 적었다.

---

## 1. 완성의 정의

완성 기준을 **자율 검증 소프트웨어 팩토리**로 고정한다. 즉 `PAIS_PROFILE=autonomous` 스택이 **신뢰 가능하게** 도는 상태다. 멀티테넌트 SaaS(테넌트 데이터 격리·과금·RBAC)는 **명시적 비목표**다 — 근거는 §7 R5.

이것은 두 층으로 쌓인다. 아래층이 서지 않으면 위층은 의미가 없다.

### 층 1 — 기본 경로 안전 태세

기본 실행 경로(대화형 챗 + 사람 승인 게이트)가 출하 가능한 태세로 배포되고, 챗 도구가 광고한 대로 동작한다.

| ID | 수용 기준 — 검증 가능한 형태 |
|---|---|
| L1-1 | `MODE=remote` + `AUTH=none` 조합에서 `loadConfig`가 throw한다 |
| L1-2 | `X-Forwarded-For`를 매 요청 바꿔도 6번째 로그인 시도가 429다 |
| L1-3 | 출하 compose에 `MODE: local`이 0건, 앱 서비스의 호스트 포트 노출이 orchestrator 1건, API 키 평문 인라인이 0건이다 |
| L1-4 | Security `validatePath`가 상대경로를 `workspaceRoot` 기준으로 해석하고, `static.test.ts`의 executor 모킹이 0건이다 |
| L1-5 | 감사 불능이 만점·이슈 0으로 보고되지 않는다 |
| L1-6 | `..`를 포함한 `localPath`가 등록 3지점 전부에서 거부된다 |
| L1-7 | SIGTERM에서 Orchestrator의 `onClose` 훅 3개가 실행되고, Manager는 HTTP 드레인이 DB 풀 종료보다 먼저다 |
| L1-8 | `node scripts/check-docs.js`가 통과하고, 확장 규칙이 "CLAUDE.md의 CI 잡 수 주장 == `ci.yml`의 job 정의 수"를 강제한다 |
| L1-9 | CI에 compose 기동 + 챗 1왕복 스모크 잡이 있고 green이다 |
| L1-10 | `all-checks-pass`의 `needs`에 `sonar`·`cpd`가 포함되고, `cpd` 스텝이 실패를 삼키지 않는다 |

### 층 2 — 자율 아크 신뢰성

플래그를 켰을 때 데이터 손실·무음 통과·죽은 버튼이 없고, 실패가 사람에게 도달한다.

| ID | 수용 기준 |
|---|---|
| L2-1 | 재분해가 진행 중 WP를 보존한다(pg 통합에서 검증, skip 수 확인 포함) |
| L2-2 | 감사 불능 결과가 security 채널을 통과시키지 않는다 |
| L2-3 | `security_audit`·`design_ui` WP가 증거 없이 통과하지 않는다 |
| L2-4 | risk write-back이 WP별 등급을 유지한다 |
| L2-5 | WP 상태 정본 enum과 상태 전이표의 값 집합이 일치한다 |
| L2-6 | 검증 실패가 사유를 담은 DecisionRequest를 만들고, 그것을 읽는 구독자가 1개 이상 존재한다 |
| L2-7 | 대기함 UI가 미구현 choice 버튼을 렌더하지 않는다 |
| L2-8 | `/metrics`가 존재하고 DLQ 적재량·PEL 깊이를 노출한다 |
| L2-9 | 마이그레이션이 2회 연속 기동에서 동일 결과를 내고, 비멱등 DDL이 정적 검사에 걸린다 |

---

## 2. 확정된 잔여 인벤토리

**검증 표기** — ◎ 직접 실행으로 확인 · ○ 코드 인용으로 확인 · △ 보고됨(재확인 필요).

### 2.1 결함 — 기본 경로에서 오늘 살아있는 것

| ID | 항목 | 근거 | 검증 |
|---|---|---|---|
| D1 | **SAST가 구조적으로 항상 0건이고 그것이 통과 증거로 영속된다** | `xzawedSecurity/src/executor.ts:7`이 workspaceRoot 재기준화 없이 `fs.realpath(targetPath)` · runner `WORKDIR /app` vs `WORKSPACE_ROOT: /workspace` · `analyzers/static.ts:99-103` 빈 배열 반환 · `verify.ts:286`이 passed 기록 | ◎ |
| D1a | **그 결함이 자기 테스트에서 한 번도 실행되지 않는다** | `analyzers/static.test.ts:7-9`가 `validatePath`를 항등 함수로 모킹 | ◎ |
| D2 | 의존성 감사 fail-open — 감사 불능이 만점 | `xzawedSecurity/src/analyzers/deps.ts` 6지점 · `security.ts:64-70` | △ |
| D3 | 출하 compose가 프로덕션 태세를 무력화 | `docker-compose.prod.yml` — `MODE: local` 1건 · `AUTH` 0건 · `secrets:` 0건 · API 키 인라인 8건 · 호스트 포트 9건 | ◎ |
| D4 | `trustProxy: true` 하드코딩으로 rate limit 키 스푸핑 | `xzawedOrchestrator/packages/server/src/server.ts:79` · `xzawedManager/packages/server/src/server.ts:58` | ◎ |
| D5 | **Orchestrator에 종료 핸들러가 없다** — `onClose` 훅 3개가 도달 불가 | `xzawedOrchestrator/packages/server/src/index.ts` 전문 13줄에 `process.on` 0건 | ◎ |
| D6 | Manager 종료 순서 역전 — DB 풀을 닫은 뒤 HTTP를 드레인 | `xzawedManager/packages/server/src/index.ts:13-14` | ◎ |
| D7 | 로거 조건이 두 서비스에서 정반대 | Manager `MODE === 'local'` vs Orchestrator `mode !== 'local'` | ◎ |
| D8 | 프로젝트 등록 3지점의 경로 검사 불일치 | `api/projects.route.ts:167-171`만 상위경로 검사, 내부 라우트·Redis 게이트웨이는 없음 | ○ |
| D9 | SSH runner shescape 무력화 | `claude/ssh-remote-runner.ts:9,37,41,43,44,51` | △ |
| D10 | 헬스체크 9종 전부 무검사 200 | Manager·Orchestrator `api/health.route.ts:4` · 에이전트 7종 `src/server.ts:6` | ◎ |

### 2.2 자율 아크 — 층 2에서만 필수

| ID | 항목 | 근거 | 검증 |
|---|---|---|---|
| F1 | 재분해가 진행 중 WP를 통째로 덮어씀(방어 함수는 있는데 미배선) | `decomposition-consumer.ts:150-156` | △ |
| F2 | risk write-back이 전 WP를 균일 덮어씀 | `db/task-graph.repo.ts:177-190` | △ |
| F3 | WP 상태 정본이 둘로 갈림 | `work-package.ts:50` vs `dispatch-constants.ts` | △ |
| F4 | `security_audit`·`design_ui` WP가 빈 플랜으로 통과 | `verify.ts:82-85`가 빈 배열 → `:334`에서 즉시 통과, 증거 기록 0회 | ◎ |
| F5 | 검증 실패 브리프가 없고 이벤트 구독자가 0 | 보고됨 | △ |
| F6 | `spec_fix`·`reject`가 결정 소비자에서 무동작 | `decision-consumer.ts:61-104`에 3분기뿐 | △ |
| F7 | WP `inputs`/`outputs`가 항상 빈 배열 | `decompose/map.ts:35-45` | △ |

### 2.3 운영 기반

| ID | 항목 | 검증 |
|---|---|---|
| O1 | 메트릭 수집 코드 0건 — DLQ 적재량·PEL 깊이·비용을 볼 수 없다 | △ |
| O2 | 마이그레이션 버전 추적 부재(Manager) — 매 기동 전량 재실행 | △ |
| O3 | 출하 compose에 healthcheck·리소스 제한 부재 | ○ |

### 2.4 정직성 — 문서와 코드의 어긋남

| ID | 항목 | 검증 |
|---|---|---|
| H1 | 루트 `CLAUDE.md`가 CI 잡을 13개로 적으나 실제 14개(`docs-check` 누락) | ◎ |
| H2 | `roadmap.md:41`의 유일한 시퀀싱 경고가 **방향이 반대다**(§8) | ◎ |
| H3 | 로드맵이 "남았다"고 적은 항목 일부가 실은 완료 | △ |

---

## 3. 계획에서 제외한 것

- **멀티테넌트 SaaS.** [LIVE_VS_FLAGGED.md](../../LIVE_VS_FLAGGED.md)가 "읽기 술어 0줄"이라 적은 것은 코드로 참이다. 그러나 그 술어는 **Manager에 호출자 신원이 없어서** 막혀 있고, 신원을 만드는 것은 인증 아키텍처 변경이다. 자율 팩토리 완성과 직교한다.
- **`AUTH` 기본값을 `jwt`로 전환.** 계획은 **출하 경로만** 하드페일로 막는다. 기본값을 뒤집으면 Playwright·pg 통합 테스트가 인증 경로를 새로 타므로 별도 슬라이스다.
- **canary/롤백.** 배포 실행부가 저장소에 없어 규모를 잴 기준이 없다.
- **계약이 저장소 밖에 있는 잔여 2건** — `near_term` 필터와 적대 검증 전략은 없는 문서를 참조한다. 계약 확보가 선행이고, 계약 없는 잔여는 완성 요건으로 세지 않는다.

---

## 4. WBS

규모는 **파일 수 · 삽입 줄 수** 범위다. 근거는 이 저장소 커밋의 실측 — 최근 30커밋 중앙값 **4파일 / +66줄**, 최대 **76파일 / +678줄**. 시간 추정은 하지 않는다(이 저장소에 시간 실적이 없다).

### E1 — 출하 태세

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S1.1 | Orchestrator 기동 하드페일 + `trustProxy` env화 + CORS 축소 | — | 5~8 / +150~280 | A |
| S1.2 | Manager `trustProxy` env화 + 로거 조건 통일 | — | 2~4 / +30~80 | C |
| S1.3 | 출하 compose 봉합(secrets 도입·포트 축소·healthcheck) | S1.1, S1.2 | 4~7 / +120~220 | A |

### E2 — 도구 정직성

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S2.1 | **SAST 경로 결합 수정 + 항등 모킹 제거** | — | 4~6 / +150~300 | B |
| S2.2 | 감사 불능 계약화(`auditable` 비트) | S2.1 | 6~9 / +200~350 | B |
| S2.3 | `localPath` 검사 단일출처화 | S1.1 | 4~8 / +120~290 | A |
| S2.4 | deploy-gate strict 기본화 **판단** | — | 0~2 / +1~40 | 병렬 |
| S2.5 | SSH runner shescape(조건부) | — | 2~3 / +80~180 | D |

### E3 — 운영 바닥

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S3.1 | 종료 경로 — Orchestrator 신설 + Manager 순서 교정 | — | 3~5 / +80~180 | 병렬 |
| S3.2 | 실검사 헬스체크(`/health/ready`) | — | 12~18 / +200~400 | 에이전트 7종 병렬 |
| S3.3 | 최소 관측성 — `/metrics` + DLQ/PEL 깊이 | — | 12~20 / +350~600 | 병렬 |
| S3.4 | 마이그레이션 버전 추적 + 비멱등 DDL 정적 가드 | — | 4~7 / +120~250 | 병렬 |

### E4 — 정직성 정산

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S4.1 | 문서 수치·상태 정산 + `check-docs` 규칙 추가 | — | 5~8 / +40~120 | 병렬 |
| S4.2 | CI 게이트 봉합(needs 보강 · 실패 삼킴 제거 · 무음 skip 가시화) | — | 4~6 / +40~120 | 병렬 |
| S4.3 | 실 왕복 스모크(compose 기동) | S1.3, S3.2 | 3~6 / +150~350 | 불가 |

### E5 — 검증 채널 신뢰성

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S5.1 | security 채널 무실행 판정 | **S2.1, S2.2** | 4~7 / +150~300 | verify |
| S5.2a | `security_audit` WP 자기검증 | S5.1 | 8~12 / +250~400 | verify |
| S5.2b | `design_ui` WP 자기검증 | S5.2a | 10~14 / +300~500 | verify |
| S5.3 | per-WP 재채점(mutation 데드락 해소) | — | 14~20 / +450~750 | risk |
| S5.4 | per-tier θ | S5.3 | 5~9 / +100~250 | verify |

### E6 — 자율 데이터 무결성

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S6.1 | WP 상태 계약 단일화 | **S3.4** | 8~14 / +300~550 | 그래프 |
| S6.2 | 재진입 병합 배선 | S6.1 | 4~8 / +150~300 | 그래프 |
| S6.3 | WP `inputs`/`outputs` 채움 | — | 3~6 / +100~250 | 독립 |

### E7 — 실패 가시성

| ID | 슬라이스 | 선행 | 규모 | 레인 |
|---|---|---|---|---|
| S7.1 | 검증 실패 브리프 + 구독자 | — | 5~9 / +200~380 | 독립 |
| S7.2 | `spec_fix` 실동작(재분해 트리거) | S6.2 | 4~8 / +150~300 | 그래프 |
| S7.3 | 대기함 UI 죽은 버튼 제거 | — | 2~4 / +30~90 | 병렬 |

---

## 5. 실행 순서

### Phase 0 — 정산·판단 (전부 병렬, 회귀 표면 0)

`S4.1` · `S4.2` · `S7.3` · `S2.4`

**왜 먼저인가.** 판단의 전제다. 로드맵이 "남았다"고 적은 것 중 일부가 실은 완료라, 정산 전에는 어떤 우선순위도 잘못된 지도 위에서 정해진다. `S4.2`는 이후 모든 슬라이스의 그물이다 — 봉투 계약 테스트가 **어느 CI 잡에서도 안 도는 상태**로 계약을 건드리면 tsc 사각지대가 그대로 열려 있다.

### Phase 1 — 안전 태세 (4개 레인 병렬, 레인 내부는 직렬)

| 레인 | 순서 | 직렬 이유 |
|---|---|---|
| A | `S1.1` → `S1.3` → `S2.3` | Orchestrator `server.ts`가 trustProxy·로거·CORS·localPath를 동시에 갖는 최대 밀집 파일 |
| B | `S2.1` → `S2.2` | 같은 서비스. **경로 결함을 먼저 고쳐야 `auditable` 비트가 의미를 갖는다** |
| C | `S1.2` → `S3.1`(Manager 부분) | Manager `server.ts`·`index.ts` |
| D | `S2.5` | 완전 고립 |

**`S1.3`이 `S1.1`·`S1.2` 뒤여야 하는 이유.** `MODE` 전환이 CORS 분기와 로거 분기를 동시에 뒤집는다. 하드페일과 CORS 축소가 먼저 들어가 있지 않으면 전환 자체가 회귀 폭탄이다.

**`S2.1`이 Phase 1인 이유.** 챗 도구 `security_audit`이 오늘 구조적으로 항상 0건이다. 이것은 자율 아크가 아니라 **기본 경로의 약속 위반**이다.

### Phase 2 — 운영 바닥

`S3.1` · `S3.2` · `S3.4` (병렬) → `S4.3`

**`S3.4`가 여기 있는 것이 핵심이다.** `S6.1`(WP 상태 CHECK 제약)을 먼저 하면, 비멱등 DDL 정적 검사가 `ADD CONSTRAINT`를 보지 않으므로 **테스트는 그린인데 두 번째 기동에서 Manager가 죽는다**(Postgres에 `ADD CONSTRAINT IF NOT EXISTS`가 없고 Manager는 매 기동 전량 재실행한다).

`S4.3`은 `S1.3`(기동 가능한 compose)과 `S3.2`(의미 있는 healthcheck)에 의존한다. 지금 스모크를 먼저 만들면 "프로세스가 살아있다"만 검증하는 잡이 된다 — 헬스체크가 무검사 200이기 때문이다.

### Phase 3 — 자율 신뢰성 (레인 병렬)

| 레인 | 순서 | 근거 |
|---|---|---|
| verify(직렬 강제) | `S5.1` → `S5.2a` → `S5.2b` → `S5.4` | `verify.ts` 단일 파일에 6개 항목이 몰린다 |
| risk | `S5.3` | verify 미접촉. mutation과 릴리스 게이트의 데드락을 푸는 유일한 경로 |
| 그래프(직렬) | `S6.1` → `S6.2` → `S7.2` | 상태 정본 → 병합 → 재분해 트리거 |
| 독립 | `S6.3` · `S7.1` · `S3.3` | 파일 교집합 0 |

### Phase 4 — 게이트 결정

`MANAGER_RELEASE_GATE` 하드 닫기 판단. **선행: `S5.1`·`S5.2a`·`S5.2b`·`S5.3` 전부.**

두 방향이 모두 닫혀야 게이트가 의미를 갖는다. 지금 닫으면 `design_ui`·`security_audit` 역할이 배정된 워크플로가 **영구 blocked**가 되고, security 채널만 켜면 **무실행이 통과로 영속**된다.

---

## 6. TDD 계약

각 슬라이스는 **먼저 실패하는 테스트**로 시작한다. "수정 전 어떻게 실패하는가"가 없는 항목은 위음성 테스트다.

| 슬라이스 | 테스트 | 수정 전 어떻게 실패하는가 |
|---|---|---|
| S1.1 | "MODE=remote이고 AUTH=none이면 기동을 거부한다" | `AUTH`가 기본 `none`이고 해당 규칙이 없어 `loadConfig`가 정상 반환 |
| S1.1 | "X-Forwarded-For를 매 요청 바꿔도 6번째 로그인은 429다" | `trustProxy: true`가 XFF를 클라이언트 IP로 채택하고 rate limit이 기본 IP 키를 써서 6번째도 통과 |
| S1.2 | "MODE=remote에서 Fastify 로거가 켜진다" | 조건이 `MODE === 'local'`이라 remote에서 false |
| S1.3 | "출하 compose는 MODE=local을 쓰지 않고 앱 포트를 호스트에 노출하지 않는다" | `MODE: local` 1건 · 포트 9건 → 파싱 후 단언 실패 |
| S2.1 | "validatePath는 상대경로를 workspaceRoot 기준으로 해석한다" | `fs.realpath(targetPath)`가 상대경로를 그대로 넘겨 호출 인자 단언 실패 |
| S2.1 | "cwd와 다른 workspaceRoot에서 상대경로 artifact의 취약점을 검출한다" | **현행 테스트가 `validatePath`를 항등 모킹해 결함 함수가 실행조차 안 된다.** 모킹을 걷으면 ENOENT로 0건 |
| S2.2 | "감사 불능은 만점·이슈 0으로 보고되지 않는다" | payload에 감사 가능 여부 필드가 아예 없어 단언 자체가 성립 안 함 |
| S2.3 | "상위경로를 포함한 localPath는 3지점 모두에서 거부된다" | 내부 라우트·Redis 게이트웨이는 루트 거부와 읽기 확인만 하므로 통과 |
| S3.1 | "SIGTERM 시 app.close가 호출되어 onClose 훅이 실행된다" | Orchestrator `index.ts`에 `process.on`이 없고 shutdown이 export되지 않아 **import 대상 자체가 없다**(컴파일 실패) |
| S3.1 | "종료 시 HTTP 드레인이 DB 풀 종료보다 먼저다" | 현재 순서가 반대라 호출 순서 배열 단언 실패 |
| S3.2 | "DB 풀이 끊기면 /health/ready가 503을 반환한다" | 상수 200 |
| S3.4 | "가드 없는 ADD CONSTRAINT는 비멱등으로 판정된다" | 정적 검사 목록에 없어 위반 픽스처에 violations가 빈 배열 |
| S4.1 | "CLAUDE.md의 CI 잡 수 주장이 ci.yml과 일치한다" | 13 대 14로 불일치 |
| S4.2 | "all-checks-pass가 sonar·cpd를 needs에 포함하고 cpd가 실패를 삼키지 않는다" | needs에 둘 다 없고 실패 삼킴이 있음 |
| S5.1 | "security_audit이 아무 파일도 스캔하지 않으면 채널이 통과하지 않는다" | 빈 이슈 배열이 정상 파싱되어 무조건 통과 기록 |
| S5.2a | "security_audit WP는 증거 없이 통과하지 않는다" | 빈 플랜 → 즉시 통과, 증거 기록 0회 |
| S5.3 | "risk write-back은 WP별 등급을 유지한다" | 전 WP를 균일 덮어쓰기 |
| S5.3 | "MEDIUM WP의 mutation skip이 릴리스 게이트를 영구 차단하지 않는다" | skip이 미증명 채널로 들어가 차단 |
| S6.1 | "WP 상태 정본 enum과 상태 전이표의 값 집합이 일치한다" | 두 정본의 교집합이 0 |
| S6.2 | "재분해는 진행 중 WP를 보존한다" | 전량 교체. **유닛만으로는 위음성** — 기본 술어가 항상 공집합이라 pg 통합 필수 |
| S7.1 | "검증 실패는 사유를 담은 DecisionRequest를 만든다" | 대상 파일이 없어 import 실패 |
| S7.2 | "spec_fix는 재분해를 트리거한다" | 결정 소비자에 해당 분기가 없어 조용히 빠져나감 |
| S7.3 | "options가 비면 미구현 choice 버튼을 렌더하지 않는다" | 폴백 상수가 4버튼을 그림 |

---

## 7. 리스크와 미해결

| # | 리스크 | 판정 |
|---|---|---|
| R1 | `AUTH` 기본값은 여전히 `none`이다. 계획은 출하 경로만 막는다 | **수용** — 로컬 단일 사용자 전제. 기본값 전환은 별도 |
| R2 | **SAST 종단 실증 미수행.** 정적 추적은 완결됐으나 컨테이너에서 "실제 취약 코드가 0건으로 나온다"를 재현하지 않았다 | **별도 추적** — `S4.3` 스모크에 SAST 왕복 1건을 포함해 종단 확정 |
| R3 | 계약이 저장소 밖에 있는 잔여 2건 | **별도 추적** — 계약 확보가 선행 |
| R4 | SonarCloud 게이트 임계값이 저장소 밖에 있다 | **별도 추적** — `S4.2`가 최소한 "필수 게이트 여부"는 저장소 안에서 확정 |
| R5 | 테넌시 백필 규모를 저장소에서 잴 수 없고, 전역 sweep은 호출자 신원 없이 닫을 수 없다 | **비목표** |
| R6 | canary/롤백은 규모를 잴 기준이 없다(배포 실행부 부재) | **별도 추적** |
| R7 | 단일 PR 상한을 넘는 슬라이스가 있다(관측성 전체) | **수용** — 티어별 분할을 계획에 못박음 |
| R8 | Manager `server.ts`는 테스트 0 + 커버리지 제외라 배선 회귀를 잡을 그물이 없다 | **별도 추적** — `S4.3` 스모크가 부분 대체이지 완전 대체가 아니다 |
| R9 | `S6.2` 유닛 테스트는 무음 no-op을 못 잡는다 | **수용** — TDD 계약에서 pg 통합 필수로 못박음. skip 수 확인 필수 |
| R10 | Phase 4 게이트 닫기는 가용성 리스크다 | **수용** — 마지막에 두고 선행 4개를 하드 조건으로 |
| R11 | Security 반환 계약이 Zod로 3중 선언돼 한쪽만 고치면 런타임까지 조용하다 | **수용** — `/contract-drift-check` 실행을 슬라이스 완료 조건에 포함 |
| R12 | 로컬에 pg/redis가 없어 통합 테스트의 CI 실통과를 확인하지 못했다 | **별도 추적** — `S4.2`가 무음 skip을 가시화하면 판정 가능 |

---

## 8. 이 계획이 로드맵과 다른 점

1. **로드맵 소진은 완성이 아니다.** [roadmap.md](../../development/roadmap.md)의 "다음 슬라이스" 4개 중 층 1 런치블로커는 0개다. P2~P6 잔여를 전부 채워도 §2.1의 결함 10건은 하나도 닫히지 않는다.

2. **로드맵이 "남았다"고 적은 것 중 일부는 이미 완료다.** 정산은 `S4.1`이 한다.

3. **로드맵의 유일한 시퀀싱 경고는 방향이 반대다.** `roadmap.md:41`은 "이 WP들의 게이트를 먼저 닫으면 채널 skip이 fail-open을 fail-closed로 위장한다"고 적었다. 코드는 그 반대다 — 릴리스 게이트는 증거 0행을 검증 불가로 **차단**한다. 먼저 닫으면 위장이 아니라 **영구 차단**(가용성 사망)이다.

   진짜 fail-open은 다른 자리에 있다. 빈 이슈 배열이 정상 파싱되어 통과 증거가 영속되고, Security 에이전트는 배포 구성에서 구조적으로 빈 배열을 낸다. **채널을 켜는 것이 끄는 것보다 덜 안전한 유일한 경로다** — 끄면 skip으로 가시화되고 켜면 통과로 보인다.

   따라서 실제 선행은 P4 잔여가 아니라 `S2.1`(경로 결합)과 `S5.1`(무실행 판정)이다.

---

## 참고

- 기본 실행 vs 플래그 게이트 → [LIVE_VS_FLAGGED.md](../../LIVE_VS_FLAGGED.md)
- 현재 진행 상황 → [roadmap.md](../../development/roadmap.md)
- 경계 계약 → [redis-envelope.md](../../spec/redis-envelope.md) · [agent-rpc.md](../../spec/agent-rpc.md)
- 보안 패턴 → [security-patterns.md](../../development/security-patterns.md)
