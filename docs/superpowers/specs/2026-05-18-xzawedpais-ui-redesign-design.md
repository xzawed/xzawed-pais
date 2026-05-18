# xzawedPAIS UI/UX 전면 리디자인 설계 문서

**작성일:** 2026-05-18  
**대상 서비스:** xzawedOrchestrator (`packages/app` — Electron + React 19)  
**목표:** 현재 순수 CSS 기반 기본 UI → Slack 수준 프리미엄 데스크톱 앱

---

## 1. 설계 결정 요약

| 항목 | 선택 | 근거 |
|---|---|---|
| 레이아웃 | IDE 하이브리드 (4패널) | 채팅 집중 + 에이전트 로그 동시 노출 |
| 테마 | VSCode Dark+ | 개발자 친숙도, 정교한 계층 구분 |
| 메시지 | 타임라인 스텝 카드 | 에이전트 흐름을 직관적으로 시각화 |
| 사이드바 | Slack 채널 스타일 | 검색·날짜 그룹·빠른 접근 |
| 구현 방식 | shadcn/ui + Tailwind CSS v4 + Framer Motion | 프리미엄 컴포넌트 + 빠른 스타일링 + 풍부한 애니메이션 |

---

## 2. 레이아웃 구조

```
┌─────┬──────────────┬──────────────────────────────────┬──────────────┐
│     │              │ TitleBar                         │              │
│     │   Sidebar    │──────────────────────────────────│  Right       │
│ Act │   210px      │ PipelineStrip                    │  Panel       │
│ Bar │              │──────────────────────────────────│  200px       │
│ 44px│ • 세션 검색  │                                  │              │
│     │ • 새 세션 +  │   Messages (scroll)              │ Live Output  │
│     │ • 날짜 그룹  │   - UserBubble                   │ Log          │
│     │ • 통합 배지  │   - AgentTimelineCard            │              │
│     │              │──────────────────────────────────│ Token 통계   │
│     │              │ InputArea                        │              │
├─────┴──────────────┴──────────────────────────────────┴──────────────┤
│ StatusBar (#007acc)                                                   │
└───────────────────────────────────────────────────────────────────────┘
```

### 패널별 역할

- **ActivityBar (44px):** 섹션 전환 (Sessions / GitHub / MCP / Plugins / Settings). 활성 표시선(3px 파랑) 애니메이션.
- **Sidebar (210px):** 세션 목록. 검색(⌘F), 날짜별 그룹, 상태 dot. 하단 통합 상태 배지.
- **MainArea (flex):** TitleBar + PipelineStrip + 메시지 스크롤 영역 + InputArea.
- **RightPanel (200px):** 실시간 에이전트 로그 스트림, 토큰/시간/파일 통계.
- **StatusBar:** 서버 상태, GitHub 연결, 버전.

---

## 3. 색상 시스템 (VSCode Dark+ 토큰)

```css
/* Tailwind CSS 변수로 정의 — tailwind.config.ts */
--background:        #1e1e1e   /* 메인 배경 */
--surface:           #252526   /* 사이드바, 카드 */
--surface-2:         #2d2d2d   /* 타이틀바, 호버 */
--border:            #3c3c3c   /* 구분선 */
--border-subtle:     #2a2a2a   /* 미세 구분선 */

--text-primary:      #d4d4d4   /* 본문 */
--text-secondary:    #bbb      /* 보조 */
--text-muted:        #888      /* 희미 */
--text-disabled:     #555      /* 비활성 */

--accent:            #0078d4   /* 파란 액센트 (활성, 버튼) */
--accent-hover:      #006cbe
--accent-surface:    #094771   /* 활성 세션 배경 */

--success:           #3fb950   /* 완료 에이전트 */
--success-surface:   #0e4429
--warning:           #f0ad4e   /* 일시정지 세션 */
--error:             #f85149

--code-bg:           #1a1a1a   /* 코드 블록 배경 */
--status-bar:        #007acc   /* 하단 상태바 */
```

---

## 4. 타이포그래피

| 용도 | 폰트 | 크기 | 굵기 |
|---|---|---|---|
| 본문 | Segoe UI / system-ui | 12px | 400 |
| 코드 | Cascadia Code / monospace | 11px | 400 |
| 레이블 (uppercase) | 상속 | 9px | 400 (letter-spacing: 1px) |
| 섹션 제목 | 상속 | 13px | 600 |
| 상태 배지 | 상속 | 9px | 500 |

---

## 5. 컴포넌트 설계

### 5.1 ActivityBar

```tsx
// 역할: 최상위 섹션 전환 (5개 버튼 + 아바타)
// 상태: activePanel (Zustand integrations.store)
// 애니메이션: 활성 표시선 slideIn (0.2s), 아이콘 scale(1.08) hover
```

### 5.2 Sidebar (리디자인)

```tsx
// 추가 요소
<SearchInput />          // ⌘F 단축키, focus glow 애니메이션
<NewSessionButton />     // + 새 세션, hover lift (-1px translateY)
<SessionGroup label="오늘" count={3}>  // 날짜별 접기/펼치기 (Framer Motion AnimatePresence)
  <SessionItem />        // dot(pulse) + 이름 + 활성 border-left
</SessionGroup>
<IntegrationBadges />    // 하단 고정 배지 3개
```

### 5.3 PipelineStrip (신규)

```tsx
// 에이전트 파이프라인 진행 상태 시각화
// done: 초록 배경 + 체크 / active: 파란 테두리 + glow 펄스 / waiting: 회색
// 스텝 간 연결선: done→active 그래디언트, waiting 회색
// 상태 변경 시 Framer Motion layout animation (0.3s ease)
```

### 5.4 AgentTimelineCard (핵심 신규)

```tsx
interface AgentTimelineCardProps {
  managerId: string
  timestamp: number
  steps: AgentStep[]
}

interface AgentStep {
  agentName: 'Planner' | 'Developer' | 'Designer' | 'Tester' | 'Builder' | 'Watcher' | 'Security'
  status: 'done' | 'active' | 'waiting' | 'error'
  durationMs?: number
  content?: string          // 마크다운 지원
  codeBlocks?: CodeBlock[]
  files?: string[]          // 수정된 파일 목록
}
```

**렌더링 규칙:**
- `done`: 초록 dot + 회색 카드 + 경과 시간 배지
- `active`: 파란 dot(pulse) + 파란 테두리 카드 + 스트리밍 커서
- `waiting`: 회색 dot + 흐린 카드 (opacity: 0.6)
- `error`: 빨간 dot + 빨간 테두리 + 에러 메시지

**타임라인 선:** CSS `::before` 그래디언트 (done→green, active→blue, waiting→gray)

**진입 애니메이션:** 각 스텝 stagger 0.08s delay로 순차 등장 (Framer Motion)

### 5.5 UserBubble

```tsx
// 오른쪽 정렬, #0078d4 배경, 10px 10px 2px 10px border-radius
// 진입: translateX(12px) → 0, opacity 0→1 (0.25s ease)
```

### 5.6 CodeBlock (신규)

```tsx
// Shiki 기반 신택스 하이라이팅 (VSCode Dark+ 테마 내장)
// 헤더: 파일명 + 복사 버튼 (클릭 시 체크 아이콘으로 0.5s 후 복원)
// 스트리밍 중: 마지막 줄에 커서 깜빡임 (blink 1s step-end)
// 언어 자동 감지 지원
```

### 5.7 ⌘K 명령어 팔레트 (신규)

```tsx
// shadcn/ui cmdk 기반 Spotlight 스타일
// 트리거: ⌘K (Mac) / Ctrl+K (Win)
// 기능: 새 세션 / 세션 전환 / 에이전트 직접 호출 / 설정 열기
// 애니메이션: blur backdrop + scale(0.95)→1 spring 진입
```

### 5.8 RightPanel (Output)

```tsx
// 에이전트별 색상 코딩 로그 스트림
// [MGR] → #0078d4 / [PLN] → #3fb950 / [DEV] → #9cdcfe
// [TST] → #f0ad4e / [BLD] → #c586c0 / [SEC] → #f85149
// 각 라인: translateY(4px)→0 fade-in (0.3s)
// 하단: 토큰 사용량 / 경과 시간 / 수정 파일 수
```

### 5.9 ToastNotification (신규)

```tsx
// shadcn/ui Sonner 기반
// 세션 완료 / 에이전트 오류 / 파일 저장 알림
// 우하단 고정, 슬라이드업 진입 + 자동 dismiss (4s)
```

---

## 6. 애니메이션 시스템

### 6.1 의존성

```json
"framer-motion": "^11.x",
"tailwindcss-animate": "^1.x"   // shadcn/ui 내장
```

### 6.2 애니메이션 카탈로그

| 요소 | 트리거 | 효과 | 지속 |
|---|---|---|---|
| ActivityBar 표시선 | 탭 전환 | slideIn (height 0→20px) | 0.2s ease |
| 새 세션 버튼 | hover | translateY(-1px) | 0.15s |
| 세션 아이템 | mount | fadeIn + translateX(-6px→0) | 0.2s |
| 세션 그룹 | 접기/펼치기 | AnimatePresence height | 0.25s ease |
| 활성 dot | 지속 | pulse glow (box-shadow) | 2s infinite |
| 파이프라인 active 스텝 | active 상태 | glow pulse border | 1.5s infinite |
| 파이프라인 스텝 전환 | 상태 변경 | layout animation | 0.3s ease |
| UserBubble | mount | translateX(12px)→0 | 0.25s ease |
| AgentTimelineCard | mount | translateX(-10px)→0 | 0.3s ease |
| 타임라인 스텝 | mount | stagger 0.08s delay | 0.25s each |
| 코드 커서 | streaming | blink step-end | 1s infinite |
| 로그 라인 | append | translateY(4px)→0 | 0.3s ease |
| ⌘K 팔레트 | open | scale(0.95)→1 + blur | 0.2s spring |
| 토스트 | show | slideUp + fadeIn | 0.3s spring |
| 설정 모달 | open | scale(0.96)→1 | 0.2s spring |
| 입력창 | focus | box-shadow glow | 0.2s ease |

### 6.3 성능 원칙

- `transform` / `opacity` 만 애니메이션 (layout thrashing 방지)
- `will-change: transform` 은 active 애니메이션에만 적용
- `prefers-reduced-motion` 미디어 쿼리 대응 (모든 애니메이션 즉시 전환)
- Framer Motion `layout` prop — 파이프라인 스텝 위치 변경 시만 사용

---

## 7. 마크다운 + 코드 렌더링

```json
"react-markdown": "^9.x",
"rehype-highlight": "^7.x",   // 또는 shiki
"remark-gfm": "^4.x"
```

- 에이전트 `content` 필드: react-markdown으로 렌더링
- 코드 펜스(` ``` `): Shiki VSCode Dark+ 테마로 하이라이팅
- 인라인 코드: `code-inline` 스타일 (`#ce9178` 색상)
- 테이블, 체크박스, 링크 GFM 지원

---

## 8. 기술 스택 변경

### 추가 의존성

```json
{
  "tailwindcss": "^4.x",
  "framer-motion": "^11.x",
  "react-markdown": "^9.x",
  "remark-gfm": "^4.x",
  "shiki": "^1.x",
  "cmdk": "^1.x",
  "sonner": "^1.x"
}
```

### shadcn/ui 컴포넌트 (선택 설치)

```
Button, Input, ScrollArea, Tooltip, Dialog (설정 모달),
Badge, Separator, Command (⌘K 팔레트), Toaster
```

### 제거

- `src/renderer/src/App.css` (451줄) → Tailwind로 대체
- 인라인 style 객체 → Tailwind 클래스로 대체

### 유지

- Zustand 스토어 3개 (구조 변경 없음)
- Electron IPC 채널 (변경 없음)
- WebSocket / REST API 클라이언트 (변경 없음)
- 기존 비즈니스 로직 전체

---

## 9. 파일 구조 변경

```
packages/app/src/renderer/src/
├── components/
│   ├── layout/
│   │   ├── ActivityBar.tsx       (리디자인)
│   │   ├── Sidebar.tsx           (리디자인)
│   │   ├── RightPanel.tsx        (리디자인)
│   │   └── StatusBar.tsx         (신규)
│   ├── chat/
│   │   ├── MessageList.tsx       (리디자인)
│   │   ├── UserBubble.tsx        (신규, MessageBubble 대체)
│   │   ├── AgentTimelineCard.tsx (신규)
│   │   ├── PipelineStrip.tsx     (신규)
│   │   ├── CodeBlock.tsx         (신규)
│   │   └── MessageInput.tsx      (리디자인)
│   ├── ui/                       (shadcn/ui 컴포넌트)
│   │   ├── button.tsx
│   │   ├── command.tsx
│   │   ├── dialog.tsx
│   │   └── ...
│   ├── CommandPalette.tsx        (신규, ⌘K)
│   ├── DynamicPanel.tsx          (유지, 리스타일)
│   ├── GitHubPanel.tsx           (유지, 리스타일)
│   ├── McpPanel.tsx              (유지, 리스타일)
│   ├── PluginPanel.tsx           (유지, 리스타일)
│   └── SettingsModal.tsx         (유지, shadcn Dialog로 교체)
├── store/                        (변경 없음)
├── lib/
│   ├── api.ts                    (변경 없음)
│   └── markdown.ts               (신규, remark/shiki 설정)
├── App.tsx                       (리디자인)
├── App.css                       (삭제)
└── main.tsx                      (변경 없음)
```

---

## 10. 구현 순서 (단계별)

1. **Phase 1 — 기반 설정** (Tailwind + shadcn + Framer Motion 설치, design token 정의)
2. **Phase 2 — 레이아웃 셸** (ActivityBar, Sidebar, RightPanel, StatusBar 리디자인)
3. **Phase 3 — 채팅 핵심** (AgentTimelineCard, PipelineStrip, UserBubble, CodeBlock)
4. **Phase 4 — 애니메이션** (Framer Motion 적용, 마이크로인터랙션 전체)
5. **Phase 5 — 기능 강화** (⌘K 팔레트, 마크다운 렌더링, 토스트 알림)
6. **Phase 6 — 나머지 패널** (GitHub, MCP, Plugin, Settings 리스타일)

---

## 11. 테스트 전략

- 기존 74개 테스트 전체 유지 (비즈니스 로직 불변)
- 신규 컴포넌트: Vitest + React Testing Library로 렌더링 스냅샷 테스트
- 애니메이션: `prefers-reduced-motion` 환경에서 smoke 테스트
- Electron IPC: 기존 통합 테스트 그대로 통과 확인

---

## 12. 비범위 (이번 리디자인에서 제외)

- xzawedOrchestrator 서버 로직 변경 없음
- xzawedManager 이하 8개 서비스 변경 없음
- Electron main process / preload 변경 없음
- 기능 추가 (새 에이전트, 새 API 엔드포인트 등) 없음
