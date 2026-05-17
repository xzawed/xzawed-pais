# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedOrchestrator는 xzawed 멀티 에이전트 시스템의 **프로젝트 지휘자** 역할을 하는 서비스다.
사용자 지시를 받아 의도를 정제한 뒤 xzawedManager(총관리자, 별도 서비스)로 전달하고 회신을 중계한다.

## 핵심 명령어

```bash
# 의존성 설치
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트
pnpm test

# 특정 패키지 테스트
cd packages/server && pnpm test

# 빌드
pnpm build

# MCP 서버 (stdio 모드)
cd packages/server && pnpm mcp
```

## 아키텍처

```
packages/
├── shared/     # 공통 TypeScript 타입 (Message, Session, UISpec, Streams)
├── server/     # Fastify 백엔드 (API, WebSocket, MCP, Claude 실행기, Redis Streams)
└── app/        # Electron 앱 (React 19 + Zustand + electron-vite)
    ├── src/main/
    │   ├── index.ts                  # IPC 채널 등록 (settings, github, mcp, plugin)
    │   ├── github-oauth-handler.ts   # OAuth 콜백 서버, safeStorage 토큰 암호화
    │   ├── mcp-process-manager.ts    # MCP 서버 프로세스 스폰·종료·상태
    │   └── plugin-manager.ts         # Claude Code / xzawed 플러그인 목록·설치·토글
    ├── src/preload/index.ts          # contextBridge API 노출
    └── src/renderer/src/
        ├── store/
        │   ├── app.store.ts           # 앱 설정, 서버 상태
        │   ├── chat.store.ts          # 세션·메시지 상태
        │   └── integrations.store.ts  # GitHub·MCP·Plugin 통합 상태 (Zustand + persist)
        └── components/
            ├── Sidebar.tsx    # 반응형 사이드바 (900px 기준 compact/expanded)
            ├── GitHubPanel.tsx
            ├── McpPanel.tsx
            └── PluginPanel.tsx
```

## Claude 실행 모드

`CLAUDE_MODE` 환경변수로 전환:
- `cli` (기본): 로컬 claude CLI 서브프로세스
- `api`: Anthropic SDK 직접 호출 (ANTHROPIC_API_KEY 필요)
- `remote`: 원격 서버 CLI (REMOTE_CLI_URL 또는 SSH 설정 필요)

## 배포 모드

`MODE=local` (기본) → 내장 서버, 로컬 Redis  
`MODE=remote` → 원격 서버, HTTPS + WebSocket

## Electron 앱 주요 환경 변수

```env
# GitHub OAuth App (선택: 미설정 시 GitHub 연결 비활성화)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

GitHub 토큰은 `electron.safeStorage`로 암호화하여 `userData/github-token.enc`에 저장.  
MCP 서버 설정은 `userData/mcp-servers.json`, 플러그인 비활성 목록은 `userData/disabled-plugins.json`.

## 관련 프로젝트

xzawed suite: `f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\`  
- 9개 서비스 모두 구현 완료: xzawedManager(3001), xzawedPlanner(3002), xzawedDeveloper(3003), xzawedDesigner(3004), xzawedTester(3005), xzawedBuilder(3006), xzawedWatcher(3007), xzawedSecurity(3008)
- Redis Streams 통신 포맷: `docs/specs/2026-05-15-orchestrator-design.md` 참고

## 형제 프로젝트

- **SCAManager** — Python 3.14 FastAPI backend with PostgreSQL, static analysis pipeline, Claude AI code review
- **ArcanaInsight** — TypeScript/Next.js + React, Supabase, Grok/Claude AI
