# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 플랫폼 개요

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획 → 개발 → 디자인 → 테스트 → 빌드 → 모니터링을 자동으로 수행한다.

**모든 서비스는 이 단일 저장소에서 관리된다.** 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

전체 API·가이드·설계 스펙은 [`docs/`](docs/README.md)를 참고한다.

## 서비스 전체 현황

| 서비스 | 포트 | 상태 | 역할 | 상세 |
|---|---|---|---|---|
| xzawedOrchestrator | 3000 | ✅ ~712건(+E2E 110건) | 사용자 지시 수신·정제 후 Manager에 전달; GitHub·MCP·Plugin 통합 Electron UI; 승인 게이트 UI(저장 전 summary 편집·전역 게이트 모드)·도메인 위키 뷰어(쓰기 인증); 인증(JWT·Rate Limit·Refresh); i18n(ko/en/ja) | [CLAUDE.md](xzawedOrchestrator/CLAUDE.md) |
| xzawedManager | 3001 | ✅ 587/608(21 skip) | Claude tool-calling 루프, 하위 에이전트 디스패치; 승인 게이트(재실행 산출물 포함·전역 모드·**fail-safe**: 파싱 불가·미지 응답은 자동 승인 금지·사람 재요청)·도메인 위키(쓰기 인증)·AgentQuery 교차질의 라우팅·**세션 이벤트소싱+트랜잭셔널 아웃박스**(append-only 진실원천·replay 복원, `EVENT_SOURCED_SESSION` flag 가역)·**Task Graph 영속**(task_graphs 가변 프로젝션+wp_state_log append-only, P1d-3)·**Task Graph 소비**(decomposition.emitted→결정론 빌드→정상 upsert / 사이클·구조오류 inconsistent 에스컬레이션, P1d-2, 미배선)·**Task Graph 디스패치**(readyNodes→wp.dispatched·step-N·DRAFTED→DISPATCHED 상태전이·M5 트랜잭셔널 아웃박스, P1d-4, 미배선)·**WP Lease**(wp_leases 가시성 타임아웃·dispatch 시 lease 획득·WP 고정 멱등키·PK dedup, P1d-5a; 만료 sweep→reclaim 재할당 attempt++·상한 초과 escalate·attempt CAS 동시성, P1d-5b, 미배선)·**WP 완료 흐름**(완료→lease release·DISPATCHED→DONE·후행 unblock 재디스패치·done-set을 latestStates 파생, P1d-6)·**Supervisor 런타임 배선**(decomposition→dispatch·lease sweep·completion→re-dispatch를 `TASK_MANAGER_ENABLED` flag 뒤로 server.ts 배선·shared 스트림·생산자 미도착이라 동작 준비, P1d-7)·**P2-3a 다단계 분해 생산자**(decompose_request→4단계 LLM 분해 epics→slice→독립 deliverables→roles→커버리지 보고→decomposition.emitted, flag)·**P2-3b 자가수선**(P4 repair 루프·소진 시 inconsistent 에스컬레이션·세로슬라이스 린트)·**P3-1 Oracle DoR 게이트**(사람 승인 오라클→satisfied-set을 디스패치 readyNodes에 pull 주입·oracle.approved 트랜잭셔널 아웃박스→Supervisor 재디스패치·oracle API·`MANAGER_ORACLE_DOR` flag, ready→dispatched 첫 개방)·**P3-2 Oracle 초안 생성**(decompose ok 경로 P7 LLM 스테이지가 story별 GWT 시나리오 초안 생성·미커버 AC stub 보장·oracleDrafts additive emit→consumer `upsertDraft`(멱등 pending·`oracleIdFor` 단일출처)→approve가 drafted→human_approved 일괄 전이로 DoR 충족·oracleStore는 `DOR||DRAFT`로 주입(`shouldWireOracleConsumer` 분리)·`MANAGER_ORACLE_DRAFT` flag, 사람은 백지 작성 대신 승인 한 번)·**P4-1 실행 워커 골격**(dispatch/reclaim이 wp.dispatch_signal 발행→WorkerConsumer가 owningRole 에이전트 자율 호출→성공 시 wp.completion 발행→기존 완료 소비자가 DONE·후행 재디스패치, 실패=lease 백스톱·새 실패 이벤트 없음·`MANAGER_TASK_WORKER` flag, dispatch→lease→complete→re-dispatch 루프 첫 end-to-end 폐합·검증 trivial=Phase 4b); github-ops·deploy-project ToolHandler; WatcherEventConsumer | [CLAUDE.md](xzawedManager/CLAUDE.md) |
| xzawedShared | — | ✅ 197/197 | 에이전트 서비스 공통 BaseConsumer(**바운드 재시도+DLQ 격리·멱등 소비 dedup·전송은 EventBus 위임**) + **EventBus 전송 추상화(RedisEventBus: 발행+소비 포트)** + validateWorkspaceRoot + resolveWorkspaceRoot + SessionDispatcher + 협업 헬퍼 + 도메인 위키 주입 포매터 + **P2-1 결정론 분해 코어**(coverageMatrix·contentHashId·mergeKeepInflight 순수 함수, senario §6 경계) + **P3-1 oracleSatisfiedSet**(§8 DoR satisfied-set 순수 코어) 라이브러리 (@xzawed/agent-streams) | [CLAUDE.md](xzawedShared/CLAUDE.md) |
| xzawedPlanner | 3002 | ✅ 94/94 | intent → 실행 가능한 Step[] 분해; AgentQuery 교차질의 발생·응답 | [CLAUDE.md](xzawedPlanner/CLAUDE.md) |
| xzawedDeveloper | 3003 | ✅ 120/120 | 코드 생성·수정, 파일 I/O | [CLAUDE.md](xzawedDeveloper/CLAUDE.md) |
| xzawedDesigner | 3004 | ✅ 84/84 | UI 컴포넌트 스펙 설계 | [CLAUDE.md](xzawedDesigner/CLAUDE.md) |
| xzawedTester | 3005 | ✅ 65/65 | 테스트 실행·분석; AgentQuery 응답; 도메인 지식 emit | [CLAUDE.md](xzawedTester/CLAUDE.md) |
| xzawedBuilder | 3006 | ✅ 140/140 | 프로젝트 빌드 감지·실행; AgentQuery 응답; 도메인 지식 emit | [CLAUDE.md](xzawedBuilder/CLAUDE.md) |
| xzawedWatcher | 3007 | ✅ 49/49 | 파일 변경 감시·이벤트 스트리밍 | [CLAUDE.md](xzawedWatcher/CLAUDE.md) |
| xzawedSecurity | 3008 | ✅ 111/111 | OWASP 보안 감사; AgentQuery 응답 | [CLAUDE.md](xzawedSecurity/CLAUDE.md) |
| xzawedLauncher | — | ✅ 20/20 | 비개발자 대상 설치·실행 런처(Docker Compose 전체 서비스 자동 관리·Claude 인증·시스템 트레이 모니터링); Electron + React 19, Turborepo | [CLAUDE.md](xzawedLauncher/CLAUDE.md) |

## 비전 3대 축 아키텍처

PR #186~#208에서 구축된 "유기적 협업 에이전트 조직" 비전의 3대 축. 설계 스펙은 [`docs/superpowers/specs/`](docs/superpowers/specs/2026-06-01-platform-vision.md) 참고.

### (a) 협업 — AgentQuery 교차질의

에이전트가 단계 수행 중 다른 에이전트의 판단이 필요하면 직접 import 없이 **Manager를 경유해 교차질의**한다. planner가 질의를 발생시키고(`AgentQuery`), tester·builder·security가 답변자로 응답한다.

- **공통 헬퍼**: `xzawedShared/src/streams/collaboration.ts` — `runCollaborativeHandle`·`createCollaborativeHandler` 팩토리로 7개 에이전트의 handle 골격(abort·query 모드·정상 경로·error 발행)을 공유. 질의 발생은 `publishAgentQuery`를 제공한 에이전트만 지원.
- **라우팅**: `xzawedManager runner.ts`의 `processToolUseBlocks`가 `AgentQueryError`를 catch → `resolveAgentTool(err.to)`로 대상 도구 해석 → 대상 핸들러를 `buildAgentQueryPayload(err)`로 실행 → 응답을 `clarificationContext`로 원 에이전트 재실행. 페이로드는 전 답변자 스키마 **필수 필드 합집합**을 placeholder로 채워(`query`·`context` 외는 검증 통과 전용·질의 모드 미사용) 어느 답변자로 라우팅돼도 DLQ/타임아웃을 막는다. **watcher는 답변 불가라 대상에서 제외**(`AGENT_TO_TOOL` 미포함 → 즉시 `is_error`).

### (b) 승인 게이트 — Human-in-the-loop

에이전트 디스패치 결과를 PO(사용자)가 승인/수정/중단하는 코드 강제 게이트.

- **순수 모듈**: `xzawedManager gates/approval-gate.ts` — `effectiveMode`(override·default 해석)·`isGatedTool`·`parseDecision(answer, failSafe=true)`(approve/revise/abort + **fail-safe**: 파싱 불가·비객체·미지 decision은 `needs_human`으로 에스컬레이션, `failSafe=false`면 레거시 approve fail-open)·`GATED_TOOLS`·`DEPLOY_TOOLS`(deploy_project는 **항상 manual**, auto override 무시)·`KNOWLEDGE_BEARING_STAGES`(plan/design/develop/security).
- **runner 훅**: `applyApprovalGate` 루프 — manual이면 `info_request`(payload.approval) 발행 후 대기 → approve(`rememberAuto`면 이후 단계 자동 승인, `saveToWiki`면 결정 요약 위키 저장)·revise(피드백으로 재실행, `MAX_GATE_REVISES` 상한)·abort(`GateAbortError`)·**needs_human**(자동 승인 금지·사유와 함께 사람 재요청, `MAX_GATE_REASKS` 초과 시 에스컬레이션). **fail-safe(`MANAGER_GATE_FAILSAFE`, 기본 true)**: revise 소진도 무음 통과 대신 에스컬레이션. senario M8(무음 통과 금지)·N1(불확실=실패).
- **승인 UI**: Orchestrator `ChatView.tsx` 승인 카드 + `POST /sessions/:id/ui-actions`(결정 → `info_response` 발행) + `lib/api.ts` `postUiAction`. **데모 시연(P4)**: design_ui 승인 시 Manager가 `buildDemoSpec`으로 결과 UISpec(components+content)을 `info_request.payload.uiSpec`에 첨부 → `UiSpecPreview`(Spec 인터프리터, `chat/uispec/registry.tsx` ~15종 styled 렌더러 + 폴백, 읽기전용·HTML 주입 없음)가 카드에 정적 목업 렌더.

### (c) 도메인 위키 — 프로젝트 지식 누적

에이전트가 산출한 도메인 지식을 프로젝트 단위로 누적하고 후속 단계에 주입한다.

- **저장소**: `xzawedManager db/knowledge.repo.ts` `KnowledgeRepo` — `domain_knowledge` 테이블(content·source_agent·category). `recentByProject`(query ILIKE·sourceAgent·category 필터)·`insertMany`·`updateById`·`deleteById`(project_id 가드).
- **runner 통합**: `injectDomainKnowledge`(도구 호출 전 최근 N건을 `context.domainKnowledge`로 주입)·`storeDomainKnowledge`(게이트 통과 결과의 `knowledge[]` 누적)·`saveApprovedDecision`(승인 결정을 `category:'decision'`로 저장, 지식성 단계 한정). 생성형 에이전트는 `xzawedShared prompt/domain-knowledge.ts` `formatDomainKnowledge`로 주입된 지식을 프롬프트에 반영.
- **위키 UI**: Manager `api/knowledge.route.ts`(GET/PATCH/DELETE, 비인증) → Orchestrator `api/knowledge.route.ts` 프록시 → `WikiPanel.tsx`(검색·출처/분류 필터·category 배지·인라인 편집·삭제).

## 공통 기술 스택

TypeScript 5 (strict mode) 공통 적용. 모든 서비스가 사용:

- **Fastify 5** — HTTP 서버 (`/health` 엔드포인트)
- **ioredis** — Redis Streams 소비자/생산자
- **Zod** — 환경변수 검증 및 스키마
- **@anthropic-ai/sdk** — Claude API 호출
- **Vitest 3** — 테스트 (`pool: 'forks'`, 프로세스 격리; Turborepo 패키지는 기본 설정 사용)
- **pnpm** — 패키지 매니저 (npm/yarn 사용 금지)

xzawedOrchestrator 추가: **@modelcontextprotocol/sdk** (MCP 서버), **React 19 + Zustand + Electron** (데스크톱 UI), **Turborepo** (xzawedOrchestrator·xzawedManager 모노레포), **@octokit/rest** (xzawedManager GitHub API).

xzawedOrchestrator Electron 앱 추가: GitHub OAuth 통합, McpProcessManager (child_process.spawn), PluginManager (Claude Code / xzawed 확장 관리), Zustand integrations.store, **Tailwind CSS v4** (디자인 토큰), **shadcn/ui** (Button·Badge·Dialog·Command 등), **Framer Motion** (UI 애니메이션), **Shiki** (코드 하이라이팅), **cmdk** (⌘K Command Palette), **sonner** (토스트). **i18next 26** + **react-i18next 17** — 한국어·영어·일본어 i18n. 문자열 추가 시 `locales/ko/app.json`에 키 추가 후 `en/ja` 동기화 필수. 서버는 `packages/server/src/i18n/server-i18n.ts` + Accept-Language 파싱.

## 테스트 패턴

### 블로킹 I/O Mock

Redis `XREADGROUP BLOCK` 등 블로킹 I/O를 mock할 때 즉시 resolve하면 macrotask 큐가 차단되어 OOM이 발생한다.
반드시 `setImmediate`로 macrotask 양보를 재현한다.

```typescript
// ❌ 마이크로태스크 루프 유발 — setTimeout이 실행되지 않아 stop()이 호출 불가
xreadgroup: vi.fn().mockResolvedValue(null)

// ✅ 올바른 패턴 — macrotask로 이벤트 루프 양보
xreadgroup: vi.fn().mockImplementation(
  () => new Promise<null>(r => setImmediate(() => r(null)))
)
```

### ioredis 테스트 환경 설정

Redis가 없는 테스트 환경에서 ioredis의 기본 무한 재연결이 이벤트 루프를 활성 상태로 유지한다.
모든 redis.client.ts에 적용:

```typescript
client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 2000,
  retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined,
})
```

### vitest Shard Coverage 병합

vitest 3.x에 `merge-coverage` 서브커맨드가 없다. shard별 `lcov.info`를 직접 병합한다:

```bash
# CI에서 shard 1/2, 2/2 실행 후
mkdir -p coverage
cat coverage/shard-*/lcov.info > coverage/lcov.info
```

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

## 공통 명령어 패턴

### Turborepo 기반 (xzawedOrchestrator, xzawedManager)

```bash
pnpm install
pnpm build                              # 전체 빌드
pnpm test                               # 전체 테스트
cd packages/server && pnpm dev          # 서버 개발 모드
cd packages/server && pnpm test <파일>  # 단일 테스트 파일
```

### 독립 서비스 (그 외 모든 에이전트)

> **⚠️ 사전 빌드 필수**: 독립 에이전트 서비스 테스트 실행 전 xzawedShared를 먼저 빌드해야 한다.
> ```bash
> cd xzawedShared && pnpm install && pnpm build && cd ..
> ```

```bash
pnpm install
pnpm dev               # tsx watch 개발 모드
pnpm test              # Vitest 전체 실행
pnpm test <파일>       # 단일 테스트 파일
pnpm build             # TypeScript 컴파일 → dist/
```

## Redis Streams 통신 구조

스트림 키 규칙:

```
{출발지}:to-{목적지}:{sessionId}   →   소비자 그룹: {목적지}-consumers
```

실제 예: `orchestrator:to-manager:{sessionId}`, `manager:to-planner:{sessionId}`, `{agent}:to-manager:{sessionId}` 등. 모든 에이전트는 `manager:to-{agent}:{sessionId}` 수신 → `{agent}:to-manager:{sessionId}` 응답 패턴을 따른다.

모든 메시지 공통 구조:

```typescript
{
  sessionId: string
  messageId: string
  timestamp: number
  type: string      // 서비스별 정의
  payload: object   // 서비스별 정의
}
```

## 공통 환경 변수

모든 서비스의 `.env.example`을 `.env`로 복사 후 실행.

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<서비스별 포트>
MODE=local
```

> **예외**: xzawedWatcher는 Claude API를 사용하지 않으므로 ANTHROPIC_API_KEY / CLAUDE_MODEL 불필요.

서비스별 추가 환경 변수, 메시지 인터페이스, 아키텍처 세부 사항은 각 서비스 디렉토리의 `CLAUDE.md`를 참고한다.

## 개발 워크플로우

**모든 작업은 Pull Request(PR)를 통해 진행한다.**

```
feature/fix 브랜치 생성 → 작업 → 테스트 통과 → 코드 검토 → PR 생성 → 머지
```

### Git Hooks 설치 (클론 후 1회)

```bash
bash scripts/install-hooks.sh
```

- **pre-commit**: 변경된 서비스만 tsc 타입 체크 (commit 시 자동)
- **pre-push**: jscpd CPD + pnpm audit (push 시 자동)
- 긴급 우회: `git commit --no-verify` (CI에서는 여전히 검사됨)

### Claude Code 스킬 (`.claude/commands/`)

- `/pr-ready` — PR 생성 전 7단계 자동 체크 (빌드·테스트·audit·CPD·E2E선택자·i18n·Dockerfile)
- `/e2e-electron` — E2E 스펙 금지 패턴 자동 감지 및 수정 가이드
- `/i18n-add <ns.key> <ko-text>` — ko/en/ja 3개 파일 동시 i18n 키 추가
- `/sonar-check` — SonarCloud 품질 게이트 로컬 사전 검증
- `/contract-drift-check` — 여러 파일에 복제된 계약 정의(타입 유니언·스키마 필드·IPC 채널) 드리프트 읽기전용 진단 (tsc 사각지대)
- `/dev-path-guard-audit` — Developer·Builder·Tester 경로/명령 실행 보안 불변식 읽기전용 정적 감사

### 규칙

1. `master`에 직접 push 금지 — 반드시 브랜치를 만들어 작업한다
   > master 직접 커밋 시 SonarCloud "New Code" 계산 기준이 꼬여 소급 PR로도 CPD 통과가 어려워진다
2. PR은 작업 완료 후 마지막에 생성한다 (Draft PR 방식 사용 금지)
3. PR 생성 전 필수 조건 (`/pr-ready` 스킬로 자동화):
   - 해당 서비스의 테스트 전체 통과 (`pnpm test`)
   - **빌드 성공 (`pnpm build`) — tsc 타입 체크 포함, 테스트 파일도 검사**
   - `pnpm audit` 취약점 0개
   - CPD 로컬 확인: `npx jscpd@3.5.10 --config .jscpd.json` (0 clones 목표)
   - i18n 키 동기화: `node scripts/check-i18n.js` (ko/en/ja 일치 확인)

### 장기 디버깅 시 컨텍스트 관리

같은 실패를 3회 이상 반복할 경우, 계속 진행하기 전에 다음을 먼저 정리한다:

```
시도한 것: [목록]
각 시도가 실패한 이유: [목록]
아직 확인하지 못한 가설: [목록]
```

이 요약 없이 계속하면 이미 실패한 접근법을 반복하게 된다. CI 로그·대시보드·외부 도구(jscpd 리포트, SonarCloud API 댓글)의 실제 출력을 코드 추론보다 우선한다.

### 브랜치 네이밍

```
feat/<서비스>/<설명>   # 새 기능
fix/<서비스>/<설명>    # 버그 수정
docs/<설명>            # 문서만 변경
chore/<설명>           # 의존성, 설정 변경
```

예: `feat/developer/file-diff-support`, `fix/security/static-analyzer-false-positive`

## 보안 아키텍처 원칙

PR #9(2026-05-17) 전체 보안 감사를 통해 수립된 공통 보안 패턴.

### 명령 실행 (Builder, Tester)
- `spawn(cmd, [], {shell:true})` **금지** — 반드시 `spawn(bin, args, {shell:false})` 사용
- Redis 페이로드의 커맨드 필드는 allowlist 검증 필수 (`ALLOWED_PREFIXES`)
- `package.json scripts` 값은 신뢰하지 않음 — 의존성 기반 하드코딩 명령어만 사용

### Redis 메시지 검증
- 모든 Redis 수신 메시지는 `safeParse`(Zod) 로 런타임 검증 후 처리
- 검증 실패 시 `xack` 후 skip (프로세스 중단 금지)

### 경로 검증
- `WORKSPACE_ROOT`가 파일시스템 루트(`/`, `C:\`)이면 시작 시 거부 — `validateWorkspaceRoot(workspaceRoot)` (from `@xzawed/agent-streams`) 호출로 통일
- LLM 생성 경로는 절대경로 허용 금지 — `workspaceRoot` 기준 상대경로로 강제
- `triggers` 등 외부 입력 glob은 절대경로·`..` 포함 시 Zod 단계에서 차단

### 인증
- `SERVICE_JWT_SECRET`은 `AUTH=jwt` 시 32자 이상 필수 (`superRefine` 강제)
- OAuth 플로우에는 반드시 `state` 파라미터 생성·검증 (CSRF 방지)

### Electron IPC
- 민감 자격증명(토큰, 키)은 렌더러에 노출 금지 — main 프로세스에서 직접 API 호출
- MCP `args`는 런타임별 위험 플래그(`-e`, `-c`, `--eval`, URL) 차단
- `electron.d.ts`에 `Window` 인터페이스 + `var electronAPI` 전역 선언 모두 필요 — 렌더러 컴포넌트가 `globalThis.electronAPI`로 접근 시 타입 추론을 위해 (`interface Window`만으로는 `typeof globalThis` 인덱스 미반영)

### SSRF / Open Redirect 방지
- `fetch` URL은 반드시 `new URL(url)` 파싱 후 `protocol`이 `http:` 또는 `https:`임을 검증 (http-remote-runner.ts, manager.client.ts)
- `shell.openExternal` 호출 전 URL 접두사 검증 필수 — 예상 접두사가 아니면 즉시 에러 (github-oauth-handler.ts)

### Redis 안정성
- `handler(msg)` 호출은 반드시 `try/finally`로 감싸 `xack` 보장 — 핸들러 예외 시 PEL 누수 방지
- `JSON.parse` + `onMessage` 모두 `try/catch/finally`로 감싸 메시지 처리 실패 시에도 `xack` 실행

### Dockerfile 보안 (SonarCloud 규칙 준수)
새 Dockerfile 작성 또는 기존 Dockerfile 수정 시 아래 항목을 반드시 확인한다.

- **`docker:S6501` — runner 스테이지에 `USER node` 필수**: 컨테이너가 root로 실행되면 SonarCloud가 Security Hotspot으로 탐지. `EXPOSE` 다음 줄, `CMD` 바로 앞에 추가.
  ```dockerfile
  EXPOSE 3XXX
  USER node
  CMD ["node", "dist/index.js"]
  ```
- **`docker:S6505` — `pnpm install`에 `--ignore-scripts` 필수**: 모든 `RUN pnpm install` 명령에 `--ignore-scripts` 포함. 순수 JS 의존성만 사용하는 한 동작에 영향 없음.
  ```dockerfile
  RUN pnpm install --frozen-lockfile --ignore-scripts
  ```
- **Dockerfile을 완전 재작성하면 모든 줄이 "신규 코드"**: SonarCloud PR 분석은 PR diff의 추가·변경된 줄만 신규 코드로 계산. Dockerfile 전체를 재작성한 경우 위 두 규칙 위반이 모두 신규 핫스팟으로 탐지됨.

### 전이 의존성 취약점 (pnpm overrides)
직접 의존성이 아닌 전이 의존성 취약점은 `pnpm audit`이 잡지만 `pnpm update`로 해결되지 않는다.
루트 `package.json`에 `pnpm.overrides`로 강제 해결:

```json
"pnpm": {
  "overrides": {
    "취약한-패키지": ">=안전한-버전"
  }
}
```

적용 후 `pnpm install` 실행으로 lock 파일 업데이트 필수.

### 브랜치 의존성 관리
같은 파일을 병렬 브랜치에서 수정하면 merge conflict가 발생한다.

- **순차 의존 관계**: 선행 PR 머지 확인 후 후행 브랜치 분기
- **병렬 작업 중 master 머지 발생 시**: 즉시 `git merge origin/master` 실행 후 충돌 해결
- **PR 설명에 명시**: "이 PR은 #N 머지 후 리뷰 요망" (의존 관계 있을 때)

## SonarCloud 트러블슈팅

상세 가이드: [docs/development/sonarcloud.md](docs/development/sonarcloud.md)

**빠른 참조**:
- CPD 실패 → `npx jscpd@3.5.10 --config .jscpd.json` 로컬 확인 먼저
- 핫스팟 규칙 ID 확인 → SonarCloud PR 댓글 링크 → Security Hotspots 탭
- Dockerfile → `USER node`(S6501), `--ignore-scripts`(S6505) 필수

## 인프라

- **Docker**: `docker-compose.yml` — Redis + 9개 서비스 전체 실행. 모든 서비스 `context: .` (프로젝트 루트) + `dockerfile: <서비스>/Dockerfile` 패턴. xzawedOrchestrator·xzawedManager는 각각 `Dockerfile.dockerignore`로 빌드 격리. planner·designer·developer·tester·builder·watcher·security에 `WORKSPACE_ROOT: /workspace` 주입, orchestrator에 `MANAGER_URL: http://manager:3001` 주입.
- **CI/CD**: `.github/workflows/ci.yml` — PR마다 9개 서비스 병렬 빌드·테스트·감사 자동 실행. `redis-integration` 잡(Redis 서비스 컨테이너), `playwright-e2e` 잡(Electron E2E, xvfb-run, 110개 스펙), `all-checks-pass` 게이트 포함. PR 전용으로 jscpd(중복 파일·줄 번호) + SonarCloud API 폴링(품질 게이트·파일별 밀도) 댓글 자동 게시.
- **Dependabot**: `.github/dependabot.yml` — 9개 서비스 + GitHub Actions 주간 의존성 업데이트.
