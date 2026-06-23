# UI 모드 토글 (per-message build/chat) 설계

- 날짜: 2026-06-23
- 상태: 승인됨 (구현 대기)
- 범위: xzawedOrchestrator 앱(`MessageInput`·`ChatView`·`lib/api.ts`·i18n). **서버 변경 0**(#337이 이미 `mode` 필드 수용).

## 1. 배경·문제

C6(#337)는 **백엔드 전용** 슬라이스라 Orchestrator 앱에서는 아직 `mode:'build'`를 보낼 수 없다(앱의 `postMessage`는 `{content, gateMode?}`만 전송). 따라서 사람이 Electron 앱에서 **자율 빌드(decompose_request)를 트리거할 수단이 없다**(통합/단위 테스트로만 실증). 이 슬라이스는 메시지별 Chat|Build 토글을 추가해 사람이 앱에서 직접 자율 빌드를 트리거할 수 있게 한다 — C0→C1(백엔드-먼저-UI-나중)과 동일한 후속 패턴.

## 2. 목표·비목표

**목표**: 입력창에 per-message **Chat|Build 토글**을 추가해, Build 선택 시 그 메시지를 `mode:'build'`로 전송(C6 서버 분기 구동). 기본 `chat`은 **현행 byte-identical**.

**비목표(YAGNI·후속)**:
- 서버 capability 질의(토글 가시성을 `ORCHESTRATOR_DECOMPOSE_ENABLED`로 게이팅) — 항상 표시·서버 폴백.
- per-session mode 영속·전송 후 리셋(sticky 유지).
- LLM 분류·build 모드 추가 UX(진행 표시 등).

## 3. 결정(승인됨)

1. **per-message 토글 in MessageInput**: 입력 영역이 "작성 + 전송 방식"을 소유. `onSend`를 `(content, mode)`로 확장(유일 호출자 ChatView).
2. **항상 표시 + 서버 폴백**: 서버 `ORCHESTRATOR_DECOMPOSE_ENABLED` off면 build도 chat 폴백(graceful·gateMode와 동일 posture). 토글 기본 chat이라 현행 동작 보존.
3. **sticky·기본 chat**: 전송 후 리셋 안 함(세그먼트 토글 표준·연속 build 자연스러움).

## 4. 아키텍처

### 4.1 MessageInput (`components/MessageInput.tsx`)
- `const [mode, setMode] = useState<'chat' | 'build'>('chat')`.
- 입력 바 하단 행(send hint/button과 같은 행 또는 좌측)에 컴팩트 세그먼트 토글: Chat 버튼(`data-testid="mode-toggle-chat"`)·Build 버튼(`data-testid="mode-toggle-build"`), 활성 모드 강조. 라벨은 i18n.
- `handleSend`가 `onSend(trimmed, mode)` 호출(value/높이 리셋은 현행 유지·mode는 sticky라 미리셋).
- `Props.onSend: (content: string, mode: 'chat' | 'build') => void`로 변경.
- 토글은 컴팩트·기존 input 바 레이아웃(Framer motion 래퍼·flex) 보존. `disabled`(스트리밍/대기) 시에도 모드 state 변경은 허용(다음 전송 대비)하되 전송 버튼은 현행대로 비활성.

### 4.2 ChatView (`components/ChatView.tsx`)
- `handleSend(content: string, mode: 'chat' | 'build')` 시그니처 변경(MessageInput `onSend`와 일치) → `postMessage(settings.serverUrl, sessionId, content, settings.gateMode, accessToken, mode)`로 mode 전달. 나머지(낙관 메시지 추가·setPending·catch) 불변.
- `<MessageInput onSend={handleSend} ... />` 그대로(타입만 호환).

### 4.3 lib/api.ts `postMessage`
- 6번째 인자 `mode?: 'chat' | 'build'` 추가: `postMessage(baseUrl, sessionId, content, gateMode?, accessToken?, mode?)`.
- body: `{ content, ...(gateMode ? { gateMode } : {}), ...(mode === 'build' ? { mode: 'build' } : {}) }` — **chat 기본이라 build일 때만 전송**(서버 default chat). gateMode 처리 불변.

### 4.4 i18n
- `chat.mode_chat`·`chat.mode_build` 추가(ko/en/ja). 토글 라벨. 신규 2키 × 3로케일.

## 5. 데이터 흐름

```
[Chat|Build 토글] → MessageInput mode state(sticky·기본 chat)
  → handleSend → onSend(content, mode)
  → ChatView.handleSend(content, mode) → postMessage(..., mode)
  → POST /sessions/:id/messages { content, gateMode?, mode:'build'? }
  → 서버 C6 분기: ORCHESTRATOR_DECOMPOSE_ENABLED on이면 decompose_request, 아니면 chat 폴백
```

## 6. 에러 처리·엣지

- **기본 chat**: 토글 미조작·mode='chat'이면 `postMessage`가 mode 키 미전송 → 서버 현행 task_request(byte-identical).
- **서버 flag off + build**: 서버가 chat 폴백(사용자는 일반 chat 응답). 앱은 항상 토글 표시(capability 질의 없음).
- **onSend 시그니처 변경**: 유일 호출자 ChatView만 영향(MessageInput는 자기 mode state 소유).

## 7. 테스트

- **ChatView browser 테스트**(`__tests__/ChatView.browser.test.tsx`·`postMessage` mock): (a) 기본 전송 → `postMessage`가 mode 인자 없이/`'chat'`로 호출(현행), (b) Build 토글(`mode-toggle-build`) 클릭 후 전송 → `postMessage`가 6번째 인자 `'build'`로 호출. 기존 send 테스트 회귀 0(시그니처 6th arg optional).
- **MessageInput**(ChatView 경유 또는 focused): 토글 렌더(`mode-toggle-chat`/`mode-toggle-build`)·클릭 시 활성 전환·전송 시 선택 mode 전달.
- **lib/api**(`decisions-api`/api 테스트 패턴): `postMessage(..., 'build')` → fetch body에 `mode:'build'` 포함; mode 미지정/`'chat'` → body에 mode 키 부재.
- i18n 동기화(`node scripts/check-i18n.js`·신규 2키 3로케일).

## 8. 수용 기준

1. 입력창 Chat|Build 토글로 Build 선택 후 전송 → `postMessage`가 `mode:'build'` 전달 → 서버 C6 분기 구동(앱에서 자율 빌드 트리거 가능).
2. 기본(토글 미조작)·chat → `postMessage` mode 키 미전송 → 현행 task_request byte-identical(회귀 0).
3. **서버 변경 0**·i18n 2키 ko/en/ja 동기화.
4. 토글 sticky·기본 chat·항상 표시.

## 9. 영향 파일

- `xzawedOrchestrator/packages/app/src/renderer/src/components/MessageInput.tsx` (mode state·토글·onSend 시그니처)
- `xzawedOrchestrator/packages/app/src/renderer/src/components/ChatView.tsx` (handleSend 시그니처·postMessage mode 전달)
- `xzawedOrchestrator/packages/app/src/renderer/src/lib/api.ts` (`postMessage` mode? 인자)
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/{ko,en,ja}/app.json` (`chat.mode_chat`·`chat.mode_build`)
- 테스트: `__tests__/ChatView.browser.test.tsx` (+ 필요 시 MessageInput/api 테스트)
- 문서: 작업 완료 후 CLAUDE.md(루트·Orchestrator) 최신화.

## 10. 후속(이 슬라이스 밖)
- 서버 capability 질의로 토글 가시성 게이팅·E2E 스펙(data-testid 기반)·build 진행 전용 UI.
