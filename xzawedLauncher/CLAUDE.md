# CLAUDE.md — xzawedLauncher

비개발자 대상 xzawedPAIS 설치·실행 런처 앱.

## 핵심 명령어

```bash
# 의존성 설치
cd xzawedLauncher && pnpm install

# shared 타입 빌드 (앱 실행 전 필수)
cd packages/shared && pnpm build && cd ..

# 개발 모드 실행
pnpm dev

# 테스트
pnpm test

# 빌드 + 패키징 (설치 파일 생성)
pnpm package
```

## 아키텍처

`packages/shared/` — 공유 TypeScript 타입 (ServiceState, WizardStep 등)  
`packages/app/src/main/` — Electron 메인 프로세스 (Docker/Claude 감지, 서비스 제어)  
`packages/app/src/preload/` — contextBridge IPC 계약  
`packages/app/src/renderer/` — React 19 UI (마법사 + 대시보드)

## 첫 실행 vs 이후 실행

- 첫 실행: `userData/setup-complete.json` 없음 → 마법사 5단계
- 이후 실행: 파일 있음 → 대시보드 직행 → 트레이 최소화

## Claude 인증 우선순위

1. `claude whoami` 성공 → CLI 모드 (구독 사용)
2. CLI 미로그인 → 브라우저 로그인 안내
3. CLI 미설치 → npm 자동 설치
4. 폴백 → Anthropic API 키 입력 (선택)

## 보안

- API 키: `electron.safeStorage`로 OS 키체인 암호화
- docker compose 경로: `process.resourcesPath` 내 고정 경로만 허용
- IPC: contextBridge 최소 노출
