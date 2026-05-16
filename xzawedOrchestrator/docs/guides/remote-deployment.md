[홈](../index.md) > [가이드](.) > 원격/팀 서버 배포

# 원격/팀 서버 배포

xzawedOrchestrator를 클라우드에 배포하거나 팀이 공유 서버를 운영하는 방법을 안내합니다.

---

## 원격 모드 아키텍처

```
사용자 PC                     클라우드 (Railway 등)
┌──────────────────┐  HTTPS  ┌──────────────────────────┐
│  Electron 앱     │ ◄─────► │  Fastify 서버 (PORT=3000) │
│  또는 API 클라이│   WSS   │                          │
│  언트            │         │  Redis (원격 인스턴스)    │
└──────────────────┘         │                          │
                              │  Claude CLI 또는 API     │
                              └──────────────────────────┘
```

---

## Railway 배포 예시

Railway는 Node.js 서비스와 Redis를 간편하게 배포할 수 있습니다.

### 1단계: Railway 프로젝트 생성

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인
railway login

# 프로젝트 생성
railway init
```

### 2단계: Redis 인스턴스 추가

Railway 대시보드 또는 CLI에서 Redis 플러그인을 추가합니다.

```bash
railway add --plugin redis
```

Railway는 자동으로 `REDIS_URL` 환경변수를 설정합니다.

### 3단계: 환경변수 설정

```bash
railway variables set MODE=remote
railway variables set PORT=3000
railway variables set AUTH=none
railway variables set CLAUDE_MODE=api
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set CLAUDE_MODEL=claude-sonnet-4-6
```

### 4단계: 배포

```bash
railway deploy
```

### 5단계: 배포 확인

```bash
# Railway가 제공하는 URL 확인
railway domain

# 헬스체크
curl https://your-app.railway.app/health
```

---

## Docker로 배포

`packages/server`에서 Docker 이미지를 빌드합니다.

### Dockerfile 예시

```dockerfile
FROM node:20-alpine AS base
RUN npm install -g pnpm

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/shared/dist ./node_modules/@xzawed/shared/dist
COPY --from=builder /app/packages/server/node_modules ./node_modules

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

```bash
# 이미지 빌드
docker build -t xzawed-orchestrator .

# 실행
docker run -p 3000:3000 \
  -e MODE=remote \
  -e CLAUDE_MODE=api \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e REDIS_URL=redis://your-redis:6379 \
  xzawed-orchestrator
```

---

## 팀 모드 설정

팀원이 공유 서버에 접속하는 팀 모드입니다.

```env
MODE=remote
PORT=3000
AUTH=jwt
# JWT_SECRET=your-strong-secret  (추후 구현)

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://default:password@redis.example.com:6379
```

각 팀원은 자신의 `userId`로 세션을 생성하며, 세션은 Redis Streams 키에 `sessionId`가 포함되어 **완전히 격리**됩니다.

> **Note:** JWT 인증의 상세 구현은 추후 릴리스에서 제공됩니다. 현재 `AUTH=jwt` 설정 시 JWT 슬롯만 확보된 상태입니다.

---

## 보안 고려사항

### HTTPS 강제

`MODE=remote`일 때 반드시 HTTPS + WSS를 사용하세요.

```bash
# nginx 리버스 프록시 예시
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### API 키 관리

```bash
# 절대 .env 파일을 git에 커밋하지 마세요
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore

# 환경변수는 배포 플랫폼의 비밀 관리 기능을 사용하세요
# Railway: railway variables set KEY=VALUE
# AWS: AWS Secrets Manager 또는 Parameter Store
```

### Redis 인증

운영 환경에서는 Redis에 비밀번호를 설정하세요.

```env
REDIS_URL=redis://default:strong-password@redis.example.com:6379
```

### 헬스체크 엔드포인트

배포 플랫폼의 헬스체크를 `GET /health`로 설정하세요. 인증 없이 접근 가능한 유일한 엔드포인트입니다.

---

## 환경별 권장 설정

| 환경 | `MODE` | `AUTH` | `CLAUDE_MODE` | Redis |
|------|--------|--------|---------------|-------|
| 개발 | `local` | `none` | `cli` or `api` | 로컬 또는 인메모리 |
| 개인 서버 | `remote` | `none` | `api` | 원격 Redis |
| 팀 서버 | `remote` | `jwt` | `api` | 원격 Redis (HA) |

---

## 다음 단계

- [MCP 서버 통합](mcp-integration.md) — Claude Code 연동
- [환경변수 목록](../reference/environment-variables.md) — 전체 설정 참조

---

## 관련 문서

- [설정 옵션 완전 가이드](configuration.md)
- [Redis Streams 메시징](../concepts/redis-streams.md)
- [REST API 레퍼런스](../reference/rest-api.md)
