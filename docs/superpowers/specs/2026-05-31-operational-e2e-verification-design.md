# xzawedPAIS 운영 환경 전체 기능 E2E 검증 설계

## 목적

xzawedPAIS 전체 기능을 실제 운영 환경(풀 스택: Redis + 9개 서비스 + Electron)에서  
처음부터 끝까지 다중 에이전트로 2회(A안 → C안) 실행·검증하고,  
각 UI 단계 스크린샷과 교차 검증 결과를 마크다운 보고서 + GitHub 이슈로 산출한다.

---

## 1. 환경 전제 조건

| 항목 | 값 |
|---|---|
| OS | Windows 10 Pro (로컬 실행) |
| Node.js | 22.x |
| pnpm | 10.x |
| Redis | 로컬 또는 Docker (`redis://localhost:6379`) |
| ANTHROPIC_API_KEY | `.env`에 설정된 실제 키 |
| CLAUDE_MODEL | `claude-sonnet-4-6` |
| Electron 빌드 | `xzawedOrchestrator/packages/app/out/` 존재 필수 |

### 서비스 포트 목록

| 서비스 | 포트 | 기동 명령 |
|---|---|---|
| xzawedOrchestrator | 3000 | `cd xzawedOrchestrator/packages/server && pnpm dev` |
| xzawedManager | 3001 | `cd xzawedManager/packages/server && pnpm dev` |
| xzawedPlanner | 3002 | `cd xzawedPlanner && pnpm dev` |
| xzawedDeveloper | 3003 | `cd xzawedDeveloper && pnpm dev` |
| xzawedDesigner | 3004 | `cd xzawedDesigner && pnpm dev` |
| xzawedTester | 3005 | `cd xzawedTester && pnpm dev` |
| xzawedBuilder | 3006 | `cd xzawedBuilder && pnpm dev` |
| xzawedWatcher | 3007 | `cd xzawedWatcher && pnpm dev` |
| xzawedSecurity | 3008 | `cd xzawedSecurity && pnpm dev` |

---

## 2. 결과물 저장 구조

```
docs/test-reports/
└── 2026-05-31/
    ├── round-A/                    # 접근법 A 결과
    │   ├── screenshots/
    │   │   ├── 01-app-init/
    │   │   ├── 02-auth/
    │   │   ├── 03-project/
    │   │   ├── 04-message/
    │   │   ├── 05-pipeline/
    │   │   ├── 06-github/
    │   │   ├── 07-mcp/
    │   │   ├── 08-plugin/
    │   │   ├── 09-settings/
    │   │   ├── 10-command-palette/
    │   │   └── 11-error-states/
    │   └── report-A.md             # 피처별 통과/실패/우려 표
    ├── round-C/                    # 접근법 C 결과
    │   ├── screenshots/            # (동일 구조)
    │   ├── report-C.md
    │   └── cross-validation/
    │       ├── cv1-ui-ux.md
    │       ├── cv2-roundA-vs-roundC.md
    │       └── cv3-docs-vs-actual.md
    └── final-report.md             # 종합 보고서
```

---

## 3. 피처별 검증 시나리오

### 피처 1: 앱 초기화

**사전 조건:** 모든 서비스 기동 완료, Electron 빌드 존재  
**검증 항목:**
- 앱 실행 시 로딩 스크린 표시
- 서버 연결 상태(StatusBar) 녹색 표시
- 초기 라우트(`/` 또는 `/login`) 정상 렌더링
- 콘솔 오류 없음

**📸 스크린샷 시점:**
1. `01-app-startup.png` — Electron 창 최초 표시 시
2. `01-loading-complete.png` — domcontentloaded 완료 후

**합격 기준:** 로딩 완료, 레이아웃 깨짐 없음, 콘솔 오류 0건

---

### 피처 2: 회원가입 / 로그인

**사전 조건:** 피처 1 통과, `AUTH=jwt` 또는 `AUTH=none`  
**검증 항목:**
- 이메일·패스워드 입력 폼 표시
- 회원가입 → 이메일 중복 오류 처리
- 로그인 성공 → JWT accessToken 저장 → 메인 화면 이동
- 로그아웃 → 로그인 화면 복귀

**📸 스크린샷 시점:**
1. `02-login-form.png` — 로그인 폼 표시
2. `02-login-success.png` — 로그인 후 메인 화면
3. `02-logout.png` — 로그아웃 후 로그인 화면

**합격 기준:** 로그인 성공, 토큰 저장, 로그아웃 정상

---

### 피처 3: 프로젝트 생성 · 전환

**사전 조건:** 피처 2 통과(로그인 상태)  
**검증 항목:**
- "새 프로젝트" 버튼 클릭 → 생성 UI 표시
- 프로젝트 이름 입력 → 생성 → 목록 반영
- 프로젝트 클릭 → ChatView 갱신 → 컨텍스트 바 프로젝트명 표시

**📸 스크린샷 시점:**
1. `03-new-project-btn.png` — 버튼 클릭 전
2. `03-project-created.png` — 생성 후 목록
3. `03-project-switched.png` — 전환 후 ChatView

**합격 기준:** 프로젝트 생성·저장, 전환 후 ChatView 올바른 프로젝트 컨텍스트

---

### 피처 4: 메시지 전송 + 실시간 스트리밍

**사전 조건:** 피처 3 통과, Manager 서비스 실행  
**검증 항목:**
- 메시지 입력 → 전송 버튼 클릭(또는 Enter)
- WebSocket으로 Manager 수신 확인
- `streaming-indicator` 표시 → 텍스트 스트리밍 표시
- `task_complete` 수신 후 스트리밍 종료

**📸 스크린샷 시점:**
1. `04-message-input.png` — 입력 상태
2. `04-streaming.png` — 스트리밍 진행 중
3. `04-response-complete.png` — 응답 완료

**합격 기준:** 응답 수신, 스트리밍 완료, 메시지 버블 정상 렌더링

---

### 피처 5: 에이전트 파이프라인 진행 표시

**사전 조건:** 피처 4 통과, Planner/Developer/Tester 서비스 실행  
**검증 항목:**
- PipelineStrip에 Planner→Developer→Tester 단계 순서대로 표시
- 각 단계 `status_update` 수신 시 하이라이트
- AgentTimelineCard에 에이전트별 결과 표시

**📸 스크린샷 시점:**
1. `05-planner-active.png` — Planner 단계 활성
2. `05-developer-active.png` — Developer 단계 활성
3. `05-pipeline-complete.png` — 전체 파이프라인 완료

**합격 기준:** 단계 순서 정확, 결과 카드 표시

---

### 피처 6: GitHub 패널 연동

**사전 조건:** GitHub OAuth App 설정(`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`)  
**검증 항목:**
- GitHub 패널 열기 → 연결 버튼 표시
- OAuth 플로우 시작(브라우저 열림 시뮬레이션 또는 토큰 직접 주입)
- 연결 후 사용자명·아바타 표시
- 저장소 목록 로드

**📸 스크린샷 시점:**
1. `06-github-disconnected.png` — 연결 전
2. `06-github-connected.png` — 연결 후 사용자 정보
3. `06-repo-list.png` — 저장소 목록

**합격 기준:** 연결 상태 표시, 저장소 목록 로드

**⚠️ 참고:** OAuth 플로우는 실제 브라우저 창을 열므로, 테스트 모드에서는 `window.__integrationsStore`로 상태 직접 주입

---

### 피처 7: MCP 서버 관리

**사전 조건:** 피처 2 통과  
**검증 항목:**
- MCP 패널 열기
- 새 서버 추가(npx 기반, 허용된 명령어)
- 서버 시작 → `running` 상태 확인
- 서버 중지 → `stopped` 상태 확인
- 서버 제거

**📸 스크린샷 시점:**
1. `07-mcp-empty.png` — 빈 목록
2. `07-mcp-added.png` — 서버 추가 후
3. `07-mcp-running.png` — 시작 후 running
4. `07-mcp-stopped.png` — 중지 후 stopped

**합격 기준:** 상태 전환 정확, SIGTERM/SIGKILL 처리

---

### 피처 8: 플러그인 관리

**사전 조건:** 피처 2 통과  
**검증 항목:**
- 플러그인 패널 열기 → 목록 표시
- 플러그인 토글(활성화) → Badge 변경
- 플러그인 토글(비활성화) → Badge 변경

**📸 스크린샷 시점:**
1. `08-plugin-list.png` — 플러그인 목록
2. `08-plugin-enabled.png` — 활성화 후
3. `08-plugin-disabled.png` — 비활성화 후

**합격 기준:** 상태 토글 정확, 재시작 없이 즉시 반영

---

### 피처 9: 설정 모달 + i18n 언어 전환

**사전 조건:** 피처 2 통과  
**검증 항목:**
- 설정 모달 열기 → 서버 URL 변경 → 저장
- 언어 선택 → 한국어(ko) → 영어(en) → 일본어(ja) 순 전환
- 전환 후 UI 전체 텍스트 반영 확인(`[data-i18n-ready]` 대기)
- `localStorage`에 선택 언어 저장 확인

**📸 스크린샷 시점:**
1. `09-settings-ko.png` — 한국어 설정 모달
2. `09-settings-en.png` — 영어 전환 후
3. `09-settings-ja.png` — 일본어 전환 후

**합격 기준:** 3개 언어 모두 정상 렌더링, 설정 저장 유지

---

### 피처 10: Command Palette

**사전 조건:** 피처 2 통과  
**검증 항목:**
- `Ctrl+K` 실행 → 팔레트 표시
- 검색어 입력 → 항목 필터링
- 항목 선택 → 해당 기능 실행
- `Escape` → 팔레트 닫힘

**📸 스크린샷 시점:**
1. `10-palette-open.png` — 팔레트 열림
2. `10-palette-search.png` — 검색 결과
3. `10-palette-executed.png` — 실행 후

**합격 기준:** 필터링 동작, 항목 실행, 닫기

---

### 피처 11: 오류 상태 + 복구

**사전 조건:** 피처 4 통과  
**검증 항목:**
- Orchestrator 서버 강제 중단 → 연결 끊김 UI 표시
- 서버 재기동 → 자동/수동 재연결
- 잘못된 자격증명 → 인증 실패 메시지 표시
- 잘못된 서버 URL → 연결 오류 표시

**📸 스크린샷 시점:**
1. `11-server-down.png` — 연결 끊김 표시
2. `11-reconnecting.png` — 재연결 시도
3. `11-auth-error.png` — 인증 오류 메시지
4. `11-recovered.png` — 복구 후 정상 상태

**합격 기준:** 오류 상태 명확히 표시, 복구 후 정상 동작

---

## 4. 교차 검증 에이전트 역할 (Round C - Wave 3)

### CV-1: UI/UX 이상 판정

각 스크린샷을 분석하여 다음을 탐지:
- 레이아웃 깨짐(overflow, clipping)
- 텍스트 잘림 또는 i18n 미적용 (`{{key}}` 미번역)
- 색상·대비 이상
- 빈 화면 또는 로딩 스피너 미종료
- 콘솔 오류 메시지 노출

### CV-2: Round A ↔ Round C 결과 비교

- 동일 피처 스크린샷 두 라운드 비교
- 비결정적 동작 탐지(A에서는 통과, C에서는 실패)
- 스트리밍 응답 내용 차이 분석
- 실행 시간 차이 기록

### CV-3: 문서 ↔ 실제 동작 불일치 탐지

- `docs/` 공식 문서의 API 흐름, UI 설명 vs 실제 동작
- CLAUDE.md 기술된 기능 vs 실제 구현 확인
- 환경 변수 문서 vs 실제 필요 변수 비교

---

## 5. GitHub 이슈 등록 기준

| 심각도 | 라벨 | 자동 등록 기준 |
|---|---|---|
| P0 Critical | `bug:critical` | 앱 크래시, 데이터 유실, 무한 루프 |
| P1 High | `bug:high` | 핵심 기능(채팅·인증·파이프라인) 동작 불가 |
| P2 Medium | `bug:medium` | 기능 부분 동작, UI 이상, 성능 저하 |
| P3 Low | `bug:low` | 표시 오류, 문서 불일치, 개선 권고 |

이슈 본문 포함 항목:
- 재현 단계
- 예상 동작 vs 실제 동작
- 관련 스크린샷 첨부(이미지 링크)
- Round A/C 중 어느 라운드에서 발견

---

## 6. 실행 흐름 요약

```
[준비]
  1. xzawedShared 빌드
  2. 9개 서비스 순차 기동 및 /health 확인
  3. Electron 앱 빌드 (out/ 없을 경우)

[ROUND A — 접근법 A]
  4. 문서·코드 감사 에이전트 실행 (기준선 확립)
  5. Playwright electron.launch() → 피처 1~11 순차 실행
  6. 각 단계 page.screenshot() 저장 → docs/test-reports/round-A/
  7. round-A/report-A.md 작성

[ROUND C — 접근법 C]
  8. Wave 1 (병렬): 서비스 재확인 + 3개 문서 교차 감사
  9. Wave 2 (순차): Electron 재실행 → 피처 1~11 재검증
  10. Wave 3 (병렬): CV-1/CV-2/CV-3 교차 검증 + 보고서 작성
  11. final-report.md 생성
  12. 발견 이슈 → GitHub 이슈 자동 등록
```

---

## 7. 성공 기준

| 기준 | 목표 |
|---|---|
| 피처 통과율 | Round A: 90%+, Round C: 95%+ |
| P0 이슈 | 0건 |
| P1 이슈 | 2건 이하 |
| 스크린샷 완전성 | 피처당 최소 2장, 총 30장 이상 |
| 문서 불일치 | 발견 즉시 이슈 등록 |
| 두 라운드 일관성 | 같은 피처 결과 불일치 시 별도 이슈 |
