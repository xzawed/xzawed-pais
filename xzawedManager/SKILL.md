---
name: manager-skills
scope: service
version: 1.0.0
description: xzawedManager 개발·디버깅·운영 스킬
---

# xzawedManager 스킬

**테스트 실행**: `cd packages/server && pnpm test` (71건)
**관련 문서**: [docs/services/manager.md](../docs/services/manager.md)

---

### add-tool-handler
새 ToolHandler 추가

**파일 위치**: `packages/server/src/tools/`

**실행 순서**:
```
1. packages/server/src/tools/<name>.ts 생성
   - createXxxHandler() 팩토리 함수 구현
   - ToolHandler<TInput, TOutput> 인터페이스 구현
   - inputSchema: Anthropic.Tool['input_schema'] (JSON Schema)

2. packages/server/src/tools/<name>.test.ts 생성
   - execute() 정상 케이스 테스트
   - 에러 케이스 테스트

3. packages/server/src/index.ts의 toolHandlers 배열에 추가

4. xzawed<Agent> 서비스에 대응하는 Consumer·Producer 구현
```

**검증**: `cd packages/server && pnpm test src/tools/<name>.test.ts`

---

### debug-tool-loop
Claude tool-calling 루프 디버깅

```bash
# Anthropic API 요청/응답 전체 로깅
ANTHROPIC_LOG=debug cd packages/server && pnpm dev

# 특정 세션의 Manager → Agent 메시지 추적
redis-cli XRANGE manager:to-planner:<sessionId> - +
redis-cli XRANGE planner:to-manager:<sessionId> - +
```

---

### add-github-op
새 GitHub 작업(Operation) 추가

**파일 위치**: `packages/server/src/tools/github-ops.ts`

**실행 순서**:
```
1. github-ops.ts의 GITHUB_OPERATIONS 맵에 새 작업 추가
2. Octokit API 호출 구현
3. inputSchema에 새 operation 추가
4. github-ops.test.ts에 테스트 추가 (Octokit mock 사용)
```

**검증**: `cd packages/server && pnpm test src/tools/github-ops.test.ts`

---

### trace-agent-dispatch
에이전트 디스패치 타이밍 추적

```bash
# 루프 시작부터 에이전트 응답까지 시간 측정
SESSION_ID=<sessionId>
redis-cli XRANGE orchestrator:to-manager:$SESSION_ID - + | head -4
redis-cli XRANGE manager:to-orchestrator:$SESSION_ID - + | tail -4
# timestamp 필드 비교로 총 처리 시간 계산
```
