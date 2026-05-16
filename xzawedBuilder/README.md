# xzawedBuilder

xzawed 멀티 에이전트 시스템의 빌드 에이전트. xzawedManager(포트 3001)로부터 빌드 요청을 받아 실행하고 결과를 반환한다.

## 전제조건

- [ ] Node.js 20+
- [ ] pnpm (`npm install -g pnpm`)
- [ ] Redis 실행 중 (`redis-server` 또는 Docker)
- [ ] `ANTHROPIC_API_KEY` 보유

## 셋업

```bash
pnpm install
cp .env.example .env
# .env 열어 ANTHROPIC_API_KEY, WORKSPACE_ROOT 편집
pnpm dev
```

헬스체크: `curl http://localhost:3006/health`

## 명령어

| 명령어 | 설명 |
|---|---|
| `pnpm dev` | tsx watch 개발 모드 |
| `pnpm build` | TypeScript 컴파일 → dist/ |
| `pnpm test` | Vitest 전체 실행 |
| `pnpm test <파일>` | 단일 파일 테스트 |

## 관련 서비스

| 서비스 | 포트 | 역할 |
|---|---|---|
| xzawedOrchestrator | 3000 | 프로젝트 지휘자 |
| xzawedManager | 3001 | 총관리자 (빌드 요청 발신) |
| xzawedBuilder | 3006 | 이 서비스 |

## 문서

- [아키텍처](docs/architecture.md)
- [설계 스펙](docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md)
- [Claude 가이드](CLAUDE.md)
