# xzawedLauncher 설계 스펙

**작성일**: 2026-05-19  
**상태**: 확정  
**대상 플랫폼**: Windows + macOS + Linux

---

## 1. 개요

비개발자가 xzawedPAIS 전체 플랫폼(Docker + 11개 서비스)을 클릭 한 번으로 설치·실행할 수 있는 **독립 Electron 데스크톱 앱**이다.

### 핵심 목표

- 터미널·개발 도구 없이 설치부터 실행까지 완료
- Claude CLI 구독을 최우선으로 활용 (API 키는 폴백)
- 설치 후 백그라운드 상주하며 서비스 상태 자동 관리
- GitHub Releases 기반 자동 업데이트

---

## 2. 아키텍처

### 프로젝트 위치

```
xzawedPAIS/
├── xzawedLauncher/          ← 신규 (이 스펙 대상)
│   ├── packages/
│   │   ├── app/             ← Electron 앱 (main + preload + renderer)
│   │   └── shared/          ← 공통 타입
│   ├── package.json
│   └── CLAUDE.md
├── .github/workflows/
│   ├── ci.yml               ← 기존 유지
│   ├── launcher-release.yml ← 신규: 런처 플랫폼별 빌드·릴리스
│   └── docker-publish.yml   ← 신규: 서비스 이미지 GHCR 배포
├── docker-compose.prod.yml  ← 신규: 사전 빌드 이미지 기반 compose
├── xzawedOrchestrator/      ← 기존 유지 (변경 없음)
└── docker-compose.yml       ← 기존 유지 (개발용)
```

### 기술 스택

| 항목 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | Electron 33 + React 19 | 기존 Orchestrator 앱과 동일 스택 |
| 빌드 | electron-vite + electron-builder | 크로스플랫폼 빌드 |
| 자동 업데이트 | electron-updater | GitHub Releases 통합 |
| 상태 관리 | Zustand | 서비스 상태 관리 |
| UI | Tailwind CSS v4 + shadcn/ui | 기존 앱과 일관된 디자인 |
| 서비스 실행 | child_process (docker compose) | docker-compose.yml 실행 |
| 설정 저장 | electron.safeStorage + userData | API 키, 설정 암호화 저장 |

### 패키징

| 플랫폼 | 형식 | 설치 방식 |
|---|---|---|
| Windows | NSIS 설치관리자 `.exe` | 더블클릭 설치 |
| macOS | DMG `.dmg` + 공증(notarize) | 드래그&드롭 설치 |
| Linux | AppImage `.AppImage` | 실행 권한 부여 후 더블클릭 |

---

## 3. 화면 흐름

```
앱 실행
  ├─ 첫 실행 감지? ──YES──▶ 마법사 5단계
  │                          └─ 완료 후 대시보드로 전환
  └─ 재실행 ──────────────▶ 대시보드 바로 진입
                              └─ 창 최소화 → 트레이 상주

업데이트 감지 (앱 시작 시)
  └─ 신버전 있음? ──YES──▶ 업데이트 확인 팝업
                            ├─ "지금 업데이트" → 백그라운드 다운로드 → 재시작
                            └─ "나중에" → 무시 (다음 실행 시 재확인)
```

---

## 4. 마법사 (첫 실행)

첫 실행 여부는 `userData/setup-complete.json` 파일 존재로 판단한다.

### Step 1 — 환영

- xzawed 로고 + 한 줄 소개
- "시작하기" 버튼
- 하단 단계 인디케이터 (● ○ ○ ○ ○)

### Step 2 — Docker 감지 및 설치

**감지 로직**: `docker info` 명령 실행 후 종료 코드 확인

| 상태 | 동작 |
|---|---|
| Docker 실행 중 | ✅ 자동 통과 → Step 3 |
| Docker 설치됨, 미실행 | Docker Desktop 시작 요청 후 대기 |
| Docker 미설치 | 플랫폼별 설치 파일 자동 다운로드 + 진행바 표시 |

- 설치 완료 후 Docker 시작 확인 (최대 60초 대기)
- 실패 시 재시도 버튼 + 수동 설치 링크 제공

### Step 3 — Claude 인증

**우선순위 로직** (`claude whoami` 명령으로 감지):

```
1순위: Claude CLI 설치 + 로그인됨
       → 계정 이메일·구독 상태 표시 후 자동 통과

2순위: Claude CLI 설치됨, 미로그인
       → "브라우저로 로그인" 버튼
       → 브라우저에서 claude.ai 로그인 → 자동 감지

3순위: Claude CLI 미설치
       → npm install -g @anthropic-ai/claude-code 자동 실행
       → 설치 완료 후 로그인 안내

폴백: 구독 없거나 "건너뛰기" 선택
       → Anthropic API 키 입력 폼 표시
       → ⚠️ "API 사용량에 따라 요금이 부과됩니다" 경고 명시
       → API 키도 선택 사항 (나중에 설정에서 변경 가능)
```

**저장**: Claude 모드 결정값(`cli` / `api`)과 API 키(있을 경우)를 `electron.safeStorage`로 암호화 저장

### Step 4 — 서비스 기동

- `docker compose -f docker-compose.prod.yml up -d` 실행 (런처 앱 번들 내 포함된 파일 기준)
- 11개 서비스(PostgreSQL, Redis + 9개 에이전트)의 헬스체크 상태를 폴링
- 각 서비스별 행: 대기 중(○) → 시작 중(◌) → 실행 중(●) 상태 전환
- 하단 실시간 로그 스트림 (docker compose logs --follow)
- 실패한 서비스가 있으면 재시도 버튼 표시

### Step 5 — 완료

- 전체 성공 시 축하 화면
- "xzawed 열기" 버튼 → Orchestrator 앱 실행 또는 브라우저로 `http://localhost:3000` 열기
- `userData/setup-complete.json` 파일 생성 (이후 실행 시 마법사 건너뜀)
- 창 닫기 → 트레이로 최소화

---

## 5. 대시보드 (이후 실행)

### 레이아웃

```
┌─────────────────────────────────────────────────────┐
│ [🎯 Orchestrator 열기] [⏹ 전체 중지] [↺ 재시작] [⚙️] │
├─────────────────────────────────────────────────────┤
│ 인프라                                               │
│ [🐘 PostgreSQL ● 실행 중] [📦 Redis ● 실행 중]       │
├─────────────────────────────────────────────────────┤
│ 에이전트 서비스                                       │
│ 🎯 Orchestrator :3000  ● 실행 중   [↺][⏹]           │
│ 🗂️ Manager      :3001  ● 실행 중   [↺][⏹]           │
│ 📋 Planner      :3002  ◌ 재시작 중 [↺][⏹]           │
│ ... (9개 서비스)                                     │
├─────────────────────────────────────────────────────┤
│ 실시간 로그                                          │
│ [orchestrator] GET /health 200 — 2ms                │
│ [planner] Restarting container...                   │
└─────────────────────────────────────────────────────┘
```

### 서비스 상태 정의

| 색상 | 의미 | 조건 |
|---|---|---|
| 녹색 ● | 실행 중 | `/health` 200 응답 |
| 주황 ◌ | 시작/재시작 중 | 컨테이너 running, 헬스체크 미통과 |
| 빨강 ✕ | 오류 | 컨테이너 exited 또는 헬스체크 실패 |
| 회색 ○ | 중지됨 | 컨테이너 stopped |

### 기능

- **개별 제어**: 서비스별 재시작(↺) / 중지(⏹) 버튼
- **전체 제어**: 전체 시작 / 중지 / 재시작
- **로그 스트림**: `docker compose logs --follow --tail=100` 실시간 출력, 서비스별 색상 구분
- **창 최소화**: 트레이로 최소화 (완전 종료 아님)

---

## 6. 시스템 트레이

### 아이콘 상태

| 색상 | 의미 |
|---|---|
| 🟢 녹색 | 11개 서비스 모두 정상 |
| 🟡 주황 | 일부 서비스 재시작 중 또는 경고 |
| 🔴 빨강 | 1개 이상 서비스 오류 또는 중지 |

### 우클릭 메뉴

```
🎯 Orchestrator 열기
📊 대시보드 표시
─────────────────
▶️ 전체 시작
⏹ 전체 중지
↺ 전체 재시작
─────────────────
🔄 업데이트 확인
⚙️ 설정
─────────────────
✕ 완전 종료
```

---

## 7. 자동 업데이트

- 앱 시작 시 GitHub Releases API로 최신 버전 확인
- 신버전 감지 시 팝업 표시:
  - 제목: "새 버전 출시 (vX.Y.Z)"
  - 변경 내용 요약 (GitHub Release notes에서 파싱)
  - "지금 업데이트" → `autoUpdater.downloadUpdate()` → 완료 시 재시작
  - "나중에" → 해당 세션 무시, 다음 시작 시 재확인
- 다운로드는 백그라운드 진행, 트레이 툴팁으로 진행률 표시

---

## 8. 설정 화면

- Claude 인증 방식 변경 (CLI ↔ API 키)
- Anthropic API 키 수정
- GitHub 토큰 설정 (선택)
- xzawedPAIS 루트 디렉터리 경로 변경 (기본: 앱 번들 내 포함)
- 시작 시 자동 실행 토글 (OS 로그인 시 런처 자동 시작)
- 업데이트 채널 선택 (stable / beta)

---

## 9. CI/CD — GitHub Actions

### Docker 이미지 배포 전략

비개발자는 소스코드 없이 설치 파일만 받으므로, 서비스 이미지는 **사전 빌드하여 GHCR(GitHub Container Registry)에 배포**한다.

```
ghcr.io/xzawed/xzawed-orchestrator:latest
ghcr.io/xzawed/xzawed-manager:latest
... (9개 서비스)
```

- `docker-compose.prod.yml`: GHCR 이미지를 pull하는 compose 파일 (소스 빌드 없음)
- `docker-publish.yml`: master 브랜치 push 시 각 서비스 이미지 자동 빌드·배포
- 런처 앱 번들에 `docker-compose.prod.yml` 포함

### 런처 앱 릴리스

```yaml
# .github/workflows/launcher-release.yml (트리거: launcher-v* 태그 push)
jobs:
  build-windows:   # NSIS .exe, Windows Server 2022
  build-macos:     # DMG + notarize, macOS 13
  build-linux:     # AppImage, Ubuntu 22.04

# 빌드 결과물을 GitHub Release에 자동 업로드
# electron-updater가 참조할 latest.yml / latest-mac.yml / latest-linux.yml 포함
```

---

## 10. 보안 고려사항

- API 키 / GitHub 토큰: `electron.safeStorage`로 OS 키체인 암호화 저장
- docker compose 실행 경로: 번들 내 고정 경로만 허용, 외부 입력 불허
- 업데이트 파일: GitHub Releases의 서명 검증 (electron-updater 기본 제공)
- IPC: contextBridge로 최소한의 API만 렌더러에 노출

---

## 11. 미포함 범위

- xzawedOrchestrator 앱 자체 수정 없음
- docker-compose.yml 수정 없음
- 기존 9개 에이전트 서비스 수정 없음
- 웹 기반(브라우저) 런처 — Electron 앱 전용
