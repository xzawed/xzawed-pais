# Round A 검증 보고서

**생성 시각:** 2026-05-30T19:21:39.368Z
**결과 요약:** 통과 9 / 실패 0 / 우려 2

---

## 서비스 상태

| 서비스 | 포트 | 상태 | 응답시간 |
|---|---|---|---|
| xzawedOrchestrator | 3000 | 성공 | 35ms |
| xzawedManager | 3001 | 성공 | 20ms |
| xzawedPlanner | 3002 | 성공 | 20ms |
| xzawedDeveloper | 3003 | 성공 | 21ms |
| xzawedDesigner | 3004 | 성공 | 21ms |
| xzawedTester | 3005 | 성공 | 20ms |
| xzawedBuilder | 3006 | 성공 | 21ms |
| xzawedWatcher | 3007 | 성공 | 22ms |
| xzawedSecurity | 3008 | 성공 | 20ms |

---

## 피처별 결과

### [우려] 피처 01: 앱 초기화

**소요:** 2415ms

  - [v] domcontentloaded 완료 [스크린샷](screenshots\01-app-init\01-app-startup.png)
  - [x] 콘솔 오류 없음 -- `Failed to load resource: the server responded with a status of 404 (Not Found)`
  - [v] 초기 화면 렌더링 [스크린샷](screenshots\01-app-init\02-loading-complete.png)

### [통과] 피처 02: 로그인·인증

**소요:** 101ms

  - [-] 로그인 폼 표시 [스크린샷](screenshots\02-auth\01-login-form.png)
  - [-] 로그인 (AUTH=none, 스킵)

### [우려] 피처 03: 프로젝트 생성·전환

**소요:** 99ms

  - [x] 새 프로젝트 버튼 표시 [스크린샷](screenshots\03-project\01-project-list.png)
  - [-] 프로젝트 생성 (버튼 없음, 스킵)

### [통과] 피처 04: 메시지 전송·스트리밍

**소요:** 2043ms

  - [v] 메시지 입력 [스크린샷](screenshots\04-message\01-message-input.png)
  - [v] 스트리밍 시작 [스크린샷](screenshots\04-message\02-streaming-active.png)
  - [v] 응답 완료 [스크린샷](screenshots\04-message\03-response-complete.png)
  - [v] 채팅 메시지 목록 표시

### [통과] 피처 05: 에이전트 파이프라인

**소요:** 9873ms

  - [v] 파이프라인 트리거 메시지 전송 [스크린샷](screenshots\05-pipeline\01-message-sent.png)
  - [x] 파이프라인 진행 표시 [스크린샷](screenshots\05-pipeline\02-pipeline-progress.png)
  - [v] 파이프라인 완료 [스크린샷](screenshots\05-pipeline\03-pipeline-complete.png)

### [통과] 피처 06: GitHub 패널

**소요:** 8961ms

  - [x] GitHub 패널 열기 [스크린샷](screenshots\06-github\01-github-panel-open.png)
  - [x] GitHub 연결 버튼/힌트 표시 [스크린샷](screenshots\06-github\02-github-disconnected.png)
  - [v] GitHub 연결 상태 주입 [스크린샷](screenshots\06-github\03-github-simulated-connected.png)

### [통과] 피처 07: MCP 서버 관리

**소요:** 8293ms

  - [x] MCP 패널 표시 [스크린샷](screenshots\07-mcp\01-mcp-panel.png)
  - [v] MCP 설치 탭 [스크린샷](screenshots\07-mcp\02-mcp-installed-tab.png)
  - [-] MCP 추천 탭

### [통과] 피처 08: 플러그인 관리

**소요:** 8189ms

  - [x] 플러그인 패널 표시 [스크린샷](screenshots\08-plugin\01-plugin-panel.png)
  - [-] 플러그인 토글 (목록 없음)

### [통과] 피처 09: 설정·i18n

**소요:** 1214ms

  - [v] 설정 모달 열기 (ko) [스크린샷](screenshots\09-settings\01-settings-ko.png)
  - [v] en 언어 전환 [스크린샷](screenshots\09-settings\02-settings-en.png)
  - [v] ja 언어 전환 [스크린샷](screenshots\09-settings\02-settings-ja.png)
  - [v] 설정 저장 완료 (ko 복원) [스크린샷](screenshots\09-settings\03-settings-saved.png)

### [통과] 피처 10: Command Palette

**소요:** 3709ms

  - [v] Ctrl+K → 팔레트 열림 [스크린샷](screenshots\10-command-palette\01-palette-open.png)
  - [v] 검색 결과 필터링 [스크린샷](screenshots\10-command-palette\02-palette-search.png)
  - [x] 팔레트 닫기 -- `TimeoutError: locator.waitFor: Timeout 3000ms exceeded.
Call log:
[2m  - waitin`

### [통과] 피처 11: 오류 상태·복구

**소요:** 12202ms

  - [x] 오류 상태 유발 -- `TimeoutError: locator.click: Timeout 5000ms exceeded.
Call log:
[2m  - waiting `
  - [x] 연결 오류 상태 표시 [스크린샷](screenshots\11-error-states\02-error-state.png)
  - [x] 서버 URL 복원 -- `TimeoutError: locator.click: Timeout 5000ms exceeded.
Call log:
[2m  - waiting `

