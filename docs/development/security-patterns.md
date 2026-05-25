# 보안 구현 패턴

xzawedPAIS 전 서비스 공통 보안 패턴. Orchestrator `CLAUDE.md`의 `## 보안 구현 패턴` 섹션에서 추출.

---

## CLI 플래그 인젝션 방지

`cli-runner.ts`: spawn args에 사용자 메시지 추가 전 `'--'` end-of-options 구분자 삽입.

```typescript
spawn('claude', ['--model', model, '--', userMessage], { shell: false })
```

## OAuth CSRF 방지

`github-oauth-handler.ts`: `randomBytes(32)` state 생성 → URL 포함 → 콜백 검증. state 불일치 시 400.

## MCP 프로세스 보안

`mcp-process-manager.ts`:
- `command` allowlist: `npx|node|python|python3|deno|uvx|bunx|bun|uv`
- `args` 위험 플래그 차단: `node -e`, `python -c`, `--eval`, URL 형태 인자
- `env` 키 차단: `PATH`, `LD_PRELOAD`, `NODE_PATH`, `HOME` 덮어쓰기 금지

## 토큰 렌더러 노출 금지

GitHub 토큰은 main 프로세스에서만 접근. `github:get-token` IPC 채널 없음. 렌더러에서 직접 획득 금지.

## XSS 방지 — CodeBlock

`dangerouslySetInnerHTML` 사용 금지. Shiki 출력은 `codeToHast()` + `toJsxRuntime()`으로 React 노드 변환.

## SSRF 방지

`http-remote-runner.ts`, `manager.client.ts`: `fetch` 전 URL scheme 검증 — `http:`/`https:` 외 차단.

```typescript
const url = new URL(rawUrl)
if (url.protocol !== 'http:' && url.protocol !== 'https:') {
  throw new Error(`허용되지 않는 프로토콜: ${url.protocol}`)
}
```

## Open Redirect 방지

`github-oauth-handler.ts`: `shell.openExternal` 전 URL이 `https://github.com/login/oauth/authorize?` 접두사인지 검증.

## Redis PEL 누수 방지

`handler()` 호출을 `try/finally`로 감싸 예외 시에도 `xack` 실행 보장. [conventions.md#xack-보장](conventions.md) 참조.

## WebSocket 인증

`auth/user-auth.hook.ts`: 브라우저 WebSocket은 커스텀 헤더 불가 → `Sec-WebSocket-Protocol: bearer.<token>` 폴백. `extractBearerToken()`이 Authorization 헤더 우선, 없으면 protocol 헤더에서 추출.

## Auth Rate Limiting

`api/auth.route.ts`: `@fastify/rate-limit`, IP당 분당 `/register`·`/login` 5회, `/refresh` 20회.

## GitHub PAT 관리

AES-256-GCM 암호화 (`github-token.crypto.ts`). 상태 조회는 `{ exists: boolean }`만 반환.

## stale closure 방지

`ChatView.tsx`: `useEffect` 내 store 액션은 `useChatStore.getState()` 획득 (의존성 배열 추가 없이 항상 최신 참조).

## 테스트 NOSONAR 억제

테스트 파일의 `/tmp` 경로, 하드코딩 IP 주소:

```typescript
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } })) // NOSONAR
vi.stubEnv('HOME', '/tmp/test-home') // NOSONAR
```

## React 코드 품질

- `React.FormEvent` → `React.SyntheticEvent<HTMLFormElement>` (React 19 deprecated)
- props 타입 → `Readonly<Props>` 감싸기 (S6759)
- `window.xxx` → `globalThis.xxx` (S7764)
- 중첩 삼항 → 별도 컴포넌트 함수 추출 (S3358)

## AbortController 재사용 금지

`abort()` 후 즉시 `new AbortController()` 교체. `AbortSignal`은 단방향이므로 재사용 불가.
