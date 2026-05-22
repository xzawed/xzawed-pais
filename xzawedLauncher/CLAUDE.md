# CLAUDE.md — xzawedLauncher

## 프로젝트 개요

xzawedLauncher는 비개발자 대상 xzawedPAIS 설치·실행 런처 앱이다.
Docker Compose로 전체 서비스를 자동 관리하고, Claude 인증을 처리하며, 시스템 트레이에서 실행 상태를 모니터링한다.

**구조:** Electron (메인 + 렌더러) + React 19 UI, Turborepo 모노레포

## 핵심 명령어

```bash
cd xzawedLauncher

# 의존성 설치
pnpm install

# shared 타입 빌드 (앱 실행 전 필수)
cd packages/shared && pnpm build && cd ../..

# 개발 모드 실행
pnpm dev

# 테스트
pnpm test

# 빌드 + 패키징 (설치 파일 생성)
pnpm package
```

## 디렉토리 구조

```
packages/
├── shared/
│   └── src/
│       ├── index.ts          # ServiceState, WizardStep 등 공유 타입 익스포트
│       └── types/
│           ├── service.ts    # ServiceState 타입 (name, status, port, ...)
│           └── wizard.ts     # WizardStep 타입 (5단계 설치 흐름)
└── app/
    └── src/
        ├── main/             # Electron 메인 프로세스
        │   ├── index.ts      # 앱 진입점
        │   ├── claude-detector.ts   # claude whoami 실행, CLI 설치 여부 확인
        │   ├── docker-manager.ts    # docker compose up/down/ps 제어
        │   ├── service-monitor.ts   # 서비스 상태 폴링 (/health 체크)
        │   ├── setup-store.ts       # userData/setup-complete.json 관리
        │   ├── tray-manager.ts      # 시스템 트레이 아이콘·메뉴
        │   └── updater.ts           # electron-updater 자동 업데이트
        ├── preload/
        │   └── index.ts      # contextBridge IPC 최소 노출
        └── renderer/
            └── src/
                ├── App.tsx         # 라우터 — 마법사 또는 대시보드
                ├── electron.d.ts   # Window + globalThis.electronAPI 타입 선언
                ├── components/     # 마법사 단계·대시보드·서비스 카드 컴포넌트
                ├── stores/         # Zustand 상태 (설치 진행, 서비스 상태)
                └── lib/            # IPC 호출 헬퍼
```

## 첫 실행 vs 이후 실행

- **첫 실행**: `userData/setup-complete.json` 없음 → 마법사 5단계 (Docker 확인 → Claude 인증 → 설정 → 서비스 시작 → 완료)
- **이후 실행**: 파일 있음 → 대시보드 직행 → 트레이 최소화

## Claude 인증 우선순위

1. `claude whoami` 성공 → CLI 모드 (구독 사용)
2. CLI 미로그인 → 브라우저 로그인 안내
3. CLI 미설치 → `npm install -g @anthropic-ai/claude-code` 자동 실행
4. 폴백 → Anthropic API 키 직접 입력 (선택)

## 환경 변수

런처 자체는 `.env` 파일 불필요. 서비스 설정은 마법사 단계에서 `docker-compose.yml` 환경변수로 주입된다.

## 보안 참고사항

- API 키: `electron.safeStorage`로 OS 키체인 암호화
- docker compose 경로: `process.resourcesPath` 내 고정 경로만 허용
- IPC: contextBridge 최소 노출 — 민감 자격증명은 메인 프로세스에서만 처리
- `electron.d.ts`: `interface Window` + `var electronAPI` 전역 선언 모두 필요 (`globalThis.electronAPI` 타입 추론)
