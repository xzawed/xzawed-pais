---
name: orchestrator-skills
scope: service
version: 1.0.0
description: xzawedOrchestrator 개발·디버깅·운영 스킬
---

# xzawedOrchestrator 스킬

**테스트 실행**: `pnpm test` (163건: server 116 + app 41 + ui 6)
**관련 문서**: [docs/services/orchestrator.md](../docs/services/orchestrator.md)

---

### add-claude-runner
새 Claude 실행기(Runner) 추가

**파일 위치**: `packages/server/src/claude/`

**실행 순서**:
```
1. runner.interface.ts의 ClaudeRunner 인터페이스 구현
2. <name>-runner.ts 생성
3. runner.factory.ts의 createRunner() 스위치에 새 모드 추가
4. config.ts의 CLAUDE_MODE enum에 추가
5. runner.factory.test.ts에 테스트 추가
```

**검증**: `cd packages/server && pnpm test src/claude/`

---

### add-auth-endpoint
새 인증 엔드포인트 추가

**파일 위치**: `packages/server/src/api/auth.route.ts`

**실행 순서**:
```
1. auth.route.ts에 새 라우트 핸들러 추가
2. Rate limiting 설정 확인 (필요 시 rateLimit 옵션 적용)
3. packages/server/src/__tests__/auth.test.ts에 통합 테스트 추가
4. docs/reference/rest-api.md 업데이트
```

**검증**: `cd packages/server && pnpm test src/__tests__/auth.test.ts`

---

### add-mcp-tool
새 MCP 도구 추가

**파일 위치**: `packages/server/src/mcp/`

**실행 순서**:
```
1. mcp/tools/ 또는 server.ts에 새 tool 핸들러 추가
2. tool 이름·설명·입력 스키마 정의 (JSON Schema)
3. mcp 테스트 파일에 새 도구 테스트 추가
4. docs/reference/mcp-tools.md 업데이트
```

**검증**: `cd packages/server && pnpm mcp` — Claude Code에서 도구 호출 테스트

---

### debug-websocket
WebSocket 연결·메시지 흐름 디버깅

```bash
# WebSocket 연결 테스트 (wscat 필요)
npx wscat -c "ws://localhost:3000/ws/sessions/<sessionId>" \
  -H "Sec-WebSocket-Protocol: bearer.<token>"

# 서버 로그에서 WS 이벤트 확인
cd packages/server && LOG_LEVEL=debug pnpm dev 2>&1 | grep -i websocket
```

---

### debug-electron-ipc
Electron IPC 채널 디버깅

```bash
# Electron 개발 모드 (DevTools 활성화)
cd packages/app && pnpm dev

# main 프로세스 로그 확인
# DevTools Console에서: window.electronAPI.<method>() 직접 호출
```

---

### add-project-route
새 프로젝트 관련 API 엔드포인트 추가

**파일 위치**: `packages/server/src/api/projects.route.ts`

**검증**: `cd packages/server && pnpm test src/api/__tests__/projects.test.ts`
