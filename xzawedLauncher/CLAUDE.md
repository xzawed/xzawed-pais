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
        │   ├── service-monitor.ts   # docker compose ps 폴링 + compose 주입 env 조립
        │   ├── setup-store.ts       # userData/setup-complete.json 관리
        │   ├── tray-manager.ts      # 시스템 트레이 아이콘·메뉴
        │   └── updater.ts           # electron-updater 자동 업데이트
        ├── preload/
        │   └── index.ts      # contextBridge IPC 최소 노출
        └── renderer/
            └── src/
                ├── App.tsx         # 라우터 — 마법사 또는 대시보드
                ├── electron.d.ts   # Window + globalThis.launcherAPI 타입 선언
                ├── components/     # 마법사 단계·대시보드·서비스 카드 컴포넌트
                ├── stores/         # Zustand 상태 (설치 진행, 서비스 상태)
                └── lib/            # IPC 호출 헬퍼 · wait-for-services(기동 대기 정책)
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

런처 자체는 `.env` 파일 불필요. 서비스 설정은 마법사 단계에서 `docker-compose.prod.yml`로 주입된다 — `POSTGRES_PASSWORD`·`CLAUDE_MODE`는 env, API 키는 compose secret 경유다(`buildDockerEnv()`).

## 함정

- **서비스 상태는 `/health` 폴링이 아니라 `docker compose ps` 읽기다.** `getServiceStatuses`가 `State === 'running' && Health === 'healthy'`일 때만 `running`으로 친다. 따라서 **compose에 healthcheck가 없는 서비스는 영영 `starting`에 머문다**(`ps --format json`의 `Health`가 빈 문자열). 앱 서비스 9종에 healthcheck가 없던 동안 마법사의 완료 조건 `states.every(s => s.status === 'running')`은 결코 참이 될 수 없었다
- **`docker compose up -d`는 healthy를 기다리지 않는다.** 컨테이너를 띄우고 돌아온다(`depends_on: service_healthy`가 걸린 선행 서비스는 예외). 그래서 `up -d` 직후 상태를 **한 번만** 읽으면 앱 서비스는 언제나 `starting`이다 — 재시도 정책은 `renderer/src/lib/wait-for-services.ts`의 순수 함수가 갖고 `StepServices`가 그것을 쓴다. 컴포넌트 안에 두면 검사할 방법이 없다
- **compose 파일은 사본 두 벌이다.** 저장소 루트와 `packages/app/resources/`(패키징 대상은 후자). 두 벌의 태세와 드리프트는 `test/main/compose-posture.test.ts`가 고정한다 — 한쪽만 고치면 Launcher만 깨진 채 남는다
- **API 키는 compose secret 으로 들어간다.** 소스가 `environment: ANTHROPIC_API_KEY`라 `buildDockerEnv()`의 env 전달을 그대로 쓴다. `file:` 소스로 바꾸면 safeStorage로 봉인된 키를 **디스크에 평문으로 써야 한다** — 후퇴다

## 보안 참고사항

- API 키: `electron.safeStorage`로 OS 키체인 암호화
- docker compose 경로: `process.resourcesPath` 내 고정 경로만 허용
- IPC: contextBridge 최소 노출 — 민감 자격증명은 메인 프로세스에서만 처리
- `electron.d.ts`: `interface Window` + `var launcherAPI` 전역 선언 모두 필요 (`globalThis.launcherAPI` 타입 추론). **전역 이름은 `launcherAPI`다** — `contextBridge.exposeInMainWorld('launcherAPI', ...)`와 짝이고 `electronAPI`라는 이름은 코드에 0건이다
