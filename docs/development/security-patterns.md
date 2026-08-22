# 보안 구현 패턴

xzawedPAIS 전 서비스 공통 보안 패턴. Orchestrator `CLAUDE.md`의 `## 보안 구현 패턴` 섹션에서 추출.

---

## LLM 생성 경로 봉쇄

LLM이 준 경로로 파일을 쓰는 곳은 Developer `fileio.ts`의 `validatePath` 하나다. 어휘 판정만으로는 두 가지가 새어 나간다.

**워크스페이스 루트 자신.** `path.relative(root, root)`는 빈 문자열이라 `startsWith('..')`도 `isAbsolute`도 아니다. `.` · `''` · `./` · `a/..` · `src/..`가 전부 통과해 루트 자신을 반환하고, delete 분기가 `fs.rename(root, root + '.bak.N')`으로 워크스페이스 디렉터리를 통째로 부모에 옮긴다. **빈 상대경로를 "안전"으로 읽지 않는다.**

**경로 중간의 심볼릭 링크.** 리프만 `realpath`하면 새 파일 생성 시 ENOENT라 어휘 경로로 폴백하는데, 그때 중간 디렉터리가 밖을 가리키는 링크여도 어휘 판정은 통과한다. **존재하는 최근접 조상**까지 realpath로 풀어 그 조상을 검사하고, 아직 없는 나머지만 이어 붙인다 — 미존재 구간은 링크일 수 없다.

파생 경로(`.tmp.{ts}` · `.bak.{ts}`)와 정리 대상 디렉터리에도 같은 봉쇄를 건다. 단일 지점 실패가 곧 탈출이 되지 않게 하는 방어심층이다.

TOCTOU는 남는다 — 검사와 쓰기 사이에 링크가 생기는 창은 없앨 수 없다. 쓰기 **후** 실경로를 재검증해 탐지만 한다.

## userContext는 서버가 정한다

`resolveWorkspaceRoot`가 `userContext?.workspaceRoot`를 설정값보다 **우선**한다. 그래서 `userContext`가 LLM 도구 입력에서 올 수 있으면 모델이 자기 워크스페이스를 고른다. 도구 `inputSchema`에 `additionalProperties: false`가 없고 이 경로에 Zod 검증도 없으므로, `RedisAgentHandler.publishRequest`가 도구 입력에서 `userContext`를 **벗겨낸 뒤** 서버 값을 붙인다.

서버 `userContext`가 undefined인 경로가 실재한다 — Manager 자신이 watcher `file_changed`로 발행하는 `task_request`에는 `userContext`가 없다. 그 경로에서 도구 입력이 그대로 흘렀다.

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
