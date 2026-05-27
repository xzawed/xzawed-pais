# xzawedLauncher — 비개발자 런처 GUI

비개발자가 xzawedPAIS 전체 플랫폼(Docker + 11개 서비스)을 터미널 없이 설치·실행할 수 있는 독립 Electron 데스크탑 앱이다.

**포트:** N/A (Electron 앱) | **상태:** 구현 완료

---

## 개요

xzawedLauncher는 개발자가 아닌 최종 사용자를 대상으로 한다. Docker Compose로 전체 서비스를 자동 관리하고, Claude 인증을 처리하며, 시스템 트레이에서 실행 상태를 모니터링한다. 사용자는 소스 코드나 터미널 없이 설치 파일을 실행하는 것만으로 xzawedPAIS 전체를 구동할 수 있다.

**첫 실행**과 **이후 실행** 두 가지 모드가 있다:
- **첫 실행**: `userData/setup-complete.json` 파일이 없으면 5단계 설치 마법사를 시작한다
- **이후 실행**: 파일이 있으면 대시보드로 바로 진입하고 시스템 트레이로 최소화된다

---

## 핵심 기능

| 기능 | 설명 |
|------|------|
| Docker Compose 자동 관리 | `docker compose up/down/restart` 제어, 서비스별 재시작·중지 |
| Claude 인증 | CLI 로그인 우선, API 키 폴백 |
| 시스템 트레이 | 서비스 전체 상태 색상 표시, 우클릭 빠른 메뉴 |
| 서비스 상태 모니터링 | `/health` 엔드포인트 폴링으로 11개 서비스 실시간 감시 |
| 자동 업데이트 | GitHub Releases 기반 `electron-updater` 자동 업데이트 |
| 설정 화면 | Claude 인증 방식 변경, API 키, GitHub 토큰, 자동 실행 설정 |

---

## 마법사 흐름 (첫 실행)

`WizardStep` 타입 순서에 따라 5단계로 진행된다:

```typescript
type WizardStep = 'welcome' | 'docker' | 'claude' | 'services' | 'complete'
```

### Step 1: welcome — 환영 화면

xzawed 로고와 한 줄 소개를 표시하고 "시작하기" 버튼으로 진행한다. 하단에 단계 인디케이터(● ○ ○ ○ ○)가 표시된다.

### Step 2: docker — Docker 감지 및 설치

`checkDocker()`가 `docker info` 명령으로 상태를 확인한다:

| `DockerInstallStatus` | 동작 |
|---|---|
| `running` | 자동 통과 → Step 3 |
| `installed-stopped` | Docker Desktop 시작 요청 후 대기 |
| `not-installed` | 플랫폼별 설치 파일 다운로드 안내 |

설치 실패 시 재시도 버튼과 수동 설치 링크를 제공한다.

### Step 3: claude — Claude 인증

`checkClaude()`가 `claude whoami` 명령을 실행하여 `ClaudeDetectStatus`를 반환한다. 우선순위 순서로 처리된다 (다음 절 참고).

인증 결과로 `SetupConfig.claudeMode`(`'cli'` 또는 `'api'`)와 API 키(입력된 경우)를 `electron.safeStorage`로 암호화 저장한다.

### Step 4: services — 서비스 기동

`docker compose -f docker-compose.prod.yml up -d`를 실행하고 각 서비스의 `/health` 엔드포인트를 폴링한다:

```
○ 대기 중 → ◌ 시작 중 → ● 실행 중
```

11개 서비스(PostgreSQL, Redis + 9개 에이전트) 상태가 행별로 표시된다. 실패 시 재시도 버튼을 제공한다.

### Step 5: complete — 완료

전체 서비스 기동 성공 시 축하 화면을 표시한다. "xzawed 열기" 버튼으로 Orchestrator 앱을 실행하거나 `http://localhost:3000`을 브라우저에서 열 수 있다. `userData/setup-complete.json`이 생성되어 이후 실행 시 마법사를 건너뛴다.

---

## 대시보드 뷰

이후 실행 시 표시되는 서비스 관제 화면이다.

```
┌─────────────────────────────────────────────────────┐
│ [Orchestrator 열기] [전체 중지] [재시작] [설정]        │
├─────────────────────────────────────────────────────┤
│ 인프라                                               │
│ [PostgreSQL ● 실행 중] [Redis ● 실행 중]              │
├─────────────────────────────────────────────────────┤
│ 에이전트 서비스                                       │
│ Orchestrator :3000  ● 실행 중   [↺][⏹]              │
│ Manager      :3001  ● 실행 중   [↺][⏹]              │
│ Planner      :3002  ◌ 재시작 중 [↺][⏹]              │
│ ... (9개 서비스)                                     │
├─────────────────────────────────────────────────────┤
│ 실시간 로그 (docker compose logs --follow)           │
└─────────────────────────────────────────────────────┘
```

| `ServiceStatus` | 색상 | 조건 |
|---|---|---|
| `running` | 녹색 ● | `/health` 200 응답 |
| `starting` | 주황 ◌ | 컨테이너 running, 헬스체크 미통과 |
| `error` | 빨강 ✕ | 컨테이너 exited 또는 헬스체크 실패 |
| `stopped` | 회색 ○ | 컨테이너 stopped |
| `restarting` | 주황 ◌ | 컨테이너 restarting 상태 |

---

## Claude 인증 우선순위

```
1순위: claude whoami 성공 → CLI 모드 (구독 사용)
       → 계정 이메일 표시 후 자동 통과

2순위: CLI 설치됨, 미로그인 → "브라우저로 로그인" 버튼
       → 브라우저에서 claude.ai 로그인 → 자동 감지 (최대 120초 대기)

3순위: CLI 미설치 → npm install -g @anthropic-ai/claude-code 자동 실행
       → 설치 완료 후 로그인 안내

폴백: 구독 없거나 "건너뛰기" 선택
      → Anthropic API 키 직접 입력 (선택)
      → "API 사용량에 따라 요금이 부과됩니다" 경고 명시
```

`ClaudeDetectStatus` 타입이 각 상태를 나타낸다:

```typescript
type ClaudeDetectStatus =
  | 'checking'
  | 'logged-in'
  | 'not-logged-in'
  | 'not-installed'
  | 'installing'
  | 'error'
```

---

## 자동 업데이트

앱 시작 시 GitHub Releases API로 최신 버전을 확인한다. 신버전 감지 시 팝업 표시:

- "지금 업데이트" → `autoUpdater.downloadUpdate()` → 백그라운드 다운로드 후 재시작
- "나중에" → 해당 세션 무시, 다음 시작 시 재확인

다운로드 진행률은 시스템 트레이 툴팁으로 표시된다.

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 33 + React 19 |
| 빌드 | electron-vite + electron-builder |
| 자동 업데이트 | electron-updater |
| 상태 관리 | Zustand |
| UI | Tailwind CSS v4 + shadcn/ui |
| 서비스 실행 | child_process.spawn (shell:false) + docker compose |
| 설정 저장 | electron.safeStorage + userData JSON 파일 |
| 테스트 | Vitest 3 |

**패키징 형식:**

| 플랫폼 | 형식 |
|---|---|
| Windows | NSIS 설치관리자 `.exe` |
| macOS | DMG `.dmg` + 공증(notarize) |
| Linux | AppImage `.AppImage` |

---

## 환경 변수

런처 자체는 `.env` 파일이 불필요하다. 서비스 설정(API 키, GitHub 토큰 등)은 마법사 단계에서 `docker-compose.prod.yml` 환경변수로 주입된다.

민감 자격증명은 `electron.safeStorage`로 OS 키체인에 암호화 저장된다.

---

## 관련 문서

- [설계 스펙](../superpowers/specs/2026-05-19-xzawed-launcher-design.md) — 전체 설계 상세
- [서비스 목록](../README.md)
- [Orchestrator](orchestrator.md) — 런처가 기동하는 핵심 서비스
