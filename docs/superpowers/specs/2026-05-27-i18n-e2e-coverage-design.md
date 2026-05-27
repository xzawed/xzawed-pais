[홈](../../README.md) > [개발](../../development/contributing.md) > 설계 스펙

# 설계 스펙: i18n 다국어 지원 + E2E 포괄 커버리지

**날짜**: 2026-05-27  
**상태**: 승인됨  
**작성자**: Claude Code (xzawed)

---

## 개요

xzawedPAIS의 두 백로그 아이템을 단일 통합 계획으로 구현한다.

1. **i18n 다국어 지원**: 한국어·영어·일본어 3개 언어 지원, i18next 기반
2. **Playwright E2E 포괄 커버리지**: 현재 13개(~5%)에서 ~106개로 확장

두 작업은 **i18n 선행** 원칙을 적용한다. i18n이 안정화된 영역 위에 E2E를 작성함으로써 재작업을 최소화한다.

---

## 배경 및 현황

### i18n 현황
- i18n 인프라 전무 (i18next, react-intl 등 미설치)
- UI+서버에 ~165개 하드코딩 문자열
  - `packages/app` 컴포넌트: ~83개 (한국어)
  - `packages/server`: ~82개 (한국어/영어 혼재)
  - `packages/ui`: LoginPage·RegisterPage·ProjectsPage (영어)
- Zustand `app.store.ts`에 locale 상태 없음

### E2E 현황
- 13개 테스트, 커버리지 ~5%
- 네비게이션 버튼 가시성 확인만 존재
- 인프라(xvfb, Electron fixture, CI 잡) 정비 완료
- POM 패턴 미적용, 텍스트 기반 선택자 혼재

---

## i18n 아키텍처

### 라이브러리
**i18next + react-i18next** 채택.
- Electron + Vite 스택에 최적화
- Next.js 의존성 없음
- 네임스페이스·lazy loading·복수형 처리 내장
- 업계 표준, 커뮤니티 지원 풍부

### 지원 언어
| 코드 | 언어 | 비고 |
|------|------|------|
| `ko` | 한국어 | 기본값, 직접 작성 |
| `en` | 영어 | 직접 작성 |
| `ja` | 일본어 | AI 초안 + 검토 |

### 파일 구조
```
xzawedOrchestrator/
└── packages/
    ├── app/src/renderer/src/locales/
    │   ├── ko/
    │   │   ├── common.json     # 공통 버튼/레이블 (확인, 취소, 저장 등)
    │   │   └── app.json        # Electron 앱 전용 문자열
    │   ├── en/
    │   │   ├── common.json
    │   │   └── app.json
    │   └── ja/
    │       ├── common.json
    │       └── app.json
    ├── ui/src/locales/
    │   ├── ko/ui.json          # 공유 컴포넌트 문자열 (LoginPage 등)
    │   ├── en/ui.json
    │   └── ja/ui.json
    └── server/src/locales/
        ├── ko/server.json      # API 오류·상태 메시지
        ├── en/server.json
        └── ja/server.json
```

### 상태 관리 확장

```typescript
// packages/app/src/renderer/src/store/app.store.ts
type Locale = 'ko' | 'en' | 'ja'

interface AppStore {
  locale: Locale           // 신규 추가
  setLocale: (locale: Locale) => void  // 신규 추가
  // 기존 필드 (serverUrl, mode, userId, serverStatus) 유지
}
```

### 언어 감지 우선순위
```
1순위: localStorage 저장값 (사용자 명시 선택)
2순위: navigator.language / OS 언어
3순위: 기본값 'ko'
```

### 서버 i18n 처리
```
클라이언트 → Accept-Language: ko 헤더 전송
Fastify 미들웨어 → 헤더 감지
→ server.json 기반 메시지 반환
```

`intent-structurer.ts`에 로케일 컨텍스트 전달하여 Claude 프롬프트 언어 반영.

---

## E2E 아키텍처

### 핵심 원칙: 로케일 무관 선택자

```typescript
// ❌ 금지 — i18n 적용 후 깨짐
page.getByText('새 세션을 시작해주세요')
page.getByText('MCP 서버')

// ✅ 허용 — 로케일 무관
page.getByTestId('empty-chat-message')
page.getByTestId('mcp-panel-heading')
page.getByRole('button', { name: /send/i })  // ARIA role은 허용
```

### Page Object Model (POM)

```
xzawedOrchestrator/packages/app/e2e/
├── fixtures.ts                  # 기존 Electron fixture (유지)
├── pages/
│   ├── LoginPage.ts
│   ├── ProjectsPage.ts
│   ├── ChatPage.ts
│   ├── SettingsModal.ts
│   └── panels/
│       ├── GitHubPanel.ts
│       ├── McpPanel.ts
│       └── PluginPanel.ts
└── specs/
    ├── auth/
    │   ├── login.spec.ts
    │   └── register.spec.ts
    ├── chat/
    │   ├── session-lifecycle.spec.ts
    │   ├── message-flow.spec.ts
    │   └── streaming.spec.ts
    ├── panels/
    │   ├── github-panel.spec.ts
    │   ├── mcp-panel.spec.ts
    │   └── plugin-panel.spec.ts
    ├── settings/
    │   └── settings.spec.ts
    ├── projects/
    │   └── project-switch.spec.ts
    ├── error-states/
    │   ├── server-disconnect.spec.ts
    │   └── auth-failure.spec.ts
    ├── i18n/
    │   └── locale-switch.spec.ts
    └── ui/
        └── command-palette.spec.ts
```

### Mock 전략
`NODE_ENV: 'test'` 환경에서 Playwright network intercept로 API 모킹.
실제 서버 없이 전체 플로우 테스트 가능.

### 테스트 규모

| 카테고리 | 기존 | 추가 | 합계 |
|---------|------|------|------|
| 인증 | 0 | 12 | 12 |
| 채팅·메시지 | 4 | 20 | 24 |
| 세션 관리 | 0 | 12 | 12 |
| 패널 (GitHub·MCP·Plugin) | 6 | 18 | 24 |
| 설정 | 3 | 7 | 10 |
| 프로젝트 전환 | 0 | 8 | 8 |
| 오류 상태 | 0 | 10 | 10 |
| 다국어 전환 | 0 | 6 | 6 |
| Command Palette | 0 | 5 | 5 |
| **합계** | **13** | **98** | **~111** |

### CI 조정
- 기존 `playwright-e2e` 잡 유지 (xvfb-run, Chromium)
- `playwright.config.ts` timeout: 30s → 60s

---

## Phase · Sprint 계획

### 전체 구조 (8주 · 4 Sprint · 2주/Sprint)

```
Phase 1 (Sprint 1, Week 1~2): i18n 기반 + E2E 인프라 정비
Phase 2 (Sprint 2, Week 3~4): i18n UI 완성 + E2E 핵심 플로우
Phase 3 (Sprint 3, Week 5~6): i18n 서버 + E2E 기능 패널
Phase 4 (Sprint 4, Week 7~8): 다국어 E2E + 포괄 커버리지 완성
```

---

### Phase 1 — Sprint 1 (Week 1~2): 기반 구축

#### i18n 트랙
- `i18next` + `react-i18next` 설치 및 Vite 플러그인 설정
- `locales/` 디렉터리 구조 생성 (ko·en·ja × common·app·ui)
- `packages/app` UI 문자열 추출 → `ko/app.json` 작성 (~83개)
- `app.store.ts` locale 상태 + setLocale 액션 추가
- `SettingsModal`에 언어 전환 UI (드롭다운: 한국어/English/日本語)
- `packages/ui` 공유 컴포넌트 문자열 추출

#### E2E 트랙
- POM 디렉터리 구조 + `LoginPage.ts`, `ChatPage.ts` 작성
- Playwright network intercept Mock 유틸리티 작성
- `data-testid` 누락 컴포넌트 보완 (EmptyChatMessage, MessageInput 등)
- `playwright.config.ts` timeout 60s로 조정
- 기존 13개 테스트를 `data-testid` 기반으로 마이그레이션

#### Sprint 1 완료 기준
- ✅ 언어 전환 시 앱 레벨 UI 문자열이 ko·en·ja로 변경
- ✅ POM 클래스 + Mock 유틸리티 동작 확인
- ✅ 기존 13개 E2E 테스트 전원 통과 유지

---

### Phase 2 — Sprint 2 (Week 3~4): UI 번역 완성 + 핵심 E2E

#### i18n 트랙
- `en/app.json`, `ja/app.json` 번역 완성
- `packages/ui` en·ja locales 번역 완성
- OS/브라우저 언어 감지 + localStorage 저장 로직
- i18n Provider 설정 완성 (Suspense 경계 처리 포함)

#### E2E 트랙
- `auth/login.spec.ts`: 로그인 성공·실패·토큰 만료 (12개)
- `chat/session-lifecycle.spec.ts`: 세션 생성·목록·선택·삭제 (12개)
- `chat/message-flow.spec.ts`: 메시지 전송·수신·표시 (10개)

#### Sprint 2 완료 기준
- ✅ ko·en·ja 언어 전환 앱 전체 동작
- ✅ 인증 + 세션 + 메시지 E2E 34개 추가 → 누적 ~47개
- ✅ CI 통과

---

### Phase 3 — Sprint 3 (Week 5~6): 서버 i18n + 기능 패널 E2E

#### i18n 트랙
- Fastify `Accept-Language` 미들웨어 구현
- `server/locales/ko·en·ja/server.json` 작성 (~82개 메시지)
- `intent-structurer.ts` 로케일 컨텍스트 전달
- WebSocket 메시지 i18n 처리 (스트리밍 상태 메시지)

#### E2E 트랙
- `panels/github-panel.spec.ts`: GitHub 연결·OAuth·레포 목록 (8개)
- `panels/mcp-panel.spec.ts`: MCP 서버 추가·삭제·상태 확인 (6개)
- `panels/plugin-panel.spec.ts`: 플러그인 관리 (4개)
- `settings/settings.spec.ts`: 설정 저장·서버 URL 변경 (7개)
- `projects/project-switch.spec.ts`: 프로젝트 등록·전환 (8개)

#### Sprint 3 완료 기준
- ✅ API 오류 메시지가 요청 언어로 반환
- ✅ 패널·설정·프로젝트 E2E 33개 추가 → 누적 ~80개
- ✅ CI 통과

---

### Phase 4 — Sprint 4 (Week 7~8): 통합 · 포괄 커버리지

#### i18n 트랙
- 전체 번역 QA (누락·어색한 표현 수정)
- `docs/guides/translation-guide.md` 작성
- CLAUDE.md 업데이트 (i18n 패턴, 환경변수, 테스트 패턴)
- 전체 문서 최신화

#### E2E 트랙
- `chat/streaming.spec.ts`: 스트리밍·코드블록·에이전트 타임라인 (10개)
- `error-states/server-disconnect.spec.ts`: 서버 단절 복구 (5개)
- `error-states/auth-failure.spec.ts`: 인증 실패·Refresh 흐름 (5개)
- `i18n/locale-switch.spec.ts`: 언어 전환 후 UI 전체 검증 (6개)
- `ui/command-palette.spec.ts`: ⌘K 팔레트 열기·검색·실행 (5개)

#### Sprint 4 완료 기준
- ✅ ko·en·ja 전체 번역 완성 + 번역 가이드 문서화
- ✅ E2E 총 ~111개, CI 전원 통과
- ✅ SonarCloud 품질 게이트 통과
- ✅ 전체 문서 최신화 + PR 머지

---

## 데이터 흐름

### i18n 클라이언트 흐름
```
앱 시작
  → detectLocale() [localStorage → navigator.language → 'ko']
  → i18n.init({ lng: detectedLocale })
  → React Provider 렌더링
  → 컴포넌트에서 useTranslation('app') 훅 사용
  → t('settings.title') → "설정" / "Settings" / "設定"

사용자 언어 변경
  → setLocale('en') [Zustand]
  → i18n.changeLanguage('en')
  → localStorage.setItem('locale', 'en')
  → 앱 전체 리렌더링
```

### i18n 서버 흐름
```
클라이언트 요청 → Accept-Language: ja 헤더
  → Fastify preHandler
  → req.locale = 'ja'
  → 핸들러에서 t('error.session_not_found', { lng: req.locale })
  → "セッションが見つかりません" 반환
```

---

## 오류 처리

### i18n
- 번역 키 누락 시: 개발 환경 콘솔 경고 + 키 문자열 그대로 표시 (사용자에게 빈 값 노출 방지)
- 번역 파일 로드 실패 시: 기본 언어(ko)로 폴백
- 잘못된 locale 값: Zod 검증으로 'ko' | 'en' | 'ja' 외 값 차단

### E2E
- Mock 서버 응답 실패: `test.fail()` 명시적 처리
- Electron 앱 크래시: fixture teardown에서 스크린샷 자동 캡처
- 타임아웃: 60s 내 미완료 시 trace 파일 저장 (CI 디버깅용)

---

## 테스트 전략

### 단위 테스트
- i18n 유틸리티 함수 (`detectLocale`, locale validator) Vitest로 테스트
- Zustand locale 액션 단위 테스트
- 서버 i18n 미들웨어 단위 테스트

### E2E 테스트
- 모든 선택자 `data-testid` 기반 (로케일 무관)
- POM 패턴으로 선택자 중앙화 (컴포넌트 변경 시 POM만 수정)
- Mock 서버로 실제 서버 의존성 제거
- `locale-switch.spec.ts`에서 언어 전환 후 핵심 UI 요소 검증

---

## 영향 범위

### 변경 파일 (주요)
| 패키지 | 파일 | 변경 유형 |
|--------|------|---------|
| `packages/app` | `app.store.ts` | 확장 |
| `packages/app` | `SettingsModal.tsx` | 확장 |
| `packages/app` | `locales/**/*.json` | 신규 |
| `packages/ui` | 모든 컴포넌트 | 문자열 추출 |
| `packages/server` | `sessions.route.ts` | 확장 |
| `packages/server` | `intent-structurer.ts` | 확장 |
| `packages/server` | `locales/**/*.json` | 신규 |
| `packages/app/e2e` | `pages/**/*.ts` | 신규 |
| `packages/app/e2e` | `specs/**/*.spec.ts` | 신규/확장 |
| `playwright.config.ts` | timeout | 수정 |

### 하위 호환성
- 기존 API 응답 구조 변경 없음 (Accept-Language 헤더만 추가)
- 기존 E2E 테스트 13개 마이그레이션 (기능 동일, 선택자만 변경)

---

## 관련 문서
- [로드맵](../../development/roadmap.md)
- [테스트 패턴](../../development/testing-patterns.md)
- [아키텍처](../../concepts/architecture.md)
- [ADR-002: CI 안정성 패턴](../../development/adr/002-ci-stability-patterns.md)
