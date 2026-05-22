[홈](../index.md) > [가이드](.) > 원격/팀 서버 배포

# 원격/팀 서버 배포

xzawedOrchestrator를 클라우드에 배포하거나 팀이 공유 서버를 운영하는 방법을 안내합니다.

## 사전 조건

- Docker 또는 Node.js 22 이상이 설치된 서버
- 원격 Redis 인스턴스
- Anthropic API 키
- HTTPS 종단 처리 (리버스 프록시 또는 플랫폼 제공)

---

## 아키텍처

```
사용자 PC                         클라우드
┌────────────────┐  HTTPS/WSS  ┌──────────────────────────────┐
│  Electron 앱   │ ◄─────────► │  Fastify 서버 (PORT=3000)    │
│  또는 API 클라 │             │                              │
│  이언트        │             │  Redis (원격 인스턴스)        │
└────────────────┘             │                              │
                               │  Anthropic API               │
                               └──────────────────────────────┘
```

---

## Docker로 배포

xzawedOrchestrator 루트의 `Dockerfile`을 사용합니다.

### 1단계: 이미지 빌드

```bash
cd xzawedOrchestrator
docker build -t xzawed-orchestrator .
```

실제 Dockerfile은 `deps` → `build` → `runner` 3단계 멀티스테이지 빌드를 사용합니다:

- `deps`: 의존성만 설치 (`pnpm install --frozen-lockfile --ignore-scripts`)
- `build`: TypeScript 컴파일 (`pnpm --filter @xzawed/shared build && pnpm --filter @xzawed/server build`)
- `runner`: 빌드 결과물과 `node_modules`만 복사, `USER node`로 실행

### 2단계: 컨테이너 실행

```bash
docker run -p 3000:3000 \
  -e MODE=remote \
  -e AUTH=none \
  -e CLAUDE_MODE=api \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CLAUDE_MODEL=claude-sonnet-4-6 \
  -e REDIS_URL=redis://your-redis:6379 \
  xzawed-orchestrator
```

---

## Railway 배포

### 1단계: Railway CLI 설치 및 로그인

```bash
npm install -g @railway/cli
railway login
railway init
```

### 2단계: Redis 인스턴스 추가

```bash
railway add --plugin redis
```

Railway는 `REDIS_URL` 환경변수를 자동으로 주입합니다.

### 3단계: 환경변수 설정

```bash
railway variables set MODE=remote
railway variables set AUTH=none
railway variables set CLAUDE_MODE=api
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set CLAUDE_MODEL=claude-sonnet-4-6
```

### 4단계: 배포 및 확인

```bash
railway deploy

# 헬스체크
curl https://your-app.railway.app/health
# {"status":"ok","timestamp":...}
```

---

## 팀 모드 설정

`AUTH=jwt`를 사용하면 서비스 간 요청에 JWT 인증이 적용됩니다. `SERVICE_JWT_SECRET`은 32자 이상이어야 합니다.

```env
MODE=remote
PORT=3000
AUTH=jwt
SERVICE_JWT_SECRET=your-strong-32-char-secret-here

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://default:password@redis.example.com:6379
```

사용자 인증(`/auth/*`, `/projects`)을 활성화하려면 추가로 설정합니다:

```env
USER_JWT_SECRET=another-32-char-secret
DATABASE_URL=postgres://user:pass@db.example.com:5432/xzawed
```

---

## 보안 설정

### HTTPS 강제 (nginx 예시)

WebSocket 업그레이드를 포함한 리버스 프록시 설정입니다.

```nginx
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

### CORS 설정

`MODE=remote`일 때 `ALLOWED_ORIGINS`를 설정하지 않으면 CORS가 전면 차단됩니다. 허용할 오리진을 쉼표로 구분하여 지정합니다.

```env
ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com
```

`MODE=local`에서는 CORS 제한이 없습니다.

### Redis 인증

운영 환경 Redis에는 반드시 비밀번호를 설정합니다.

```env
REDIS_URL=redis://default:strong-password@redis.example.com:6379
```

### API 키 관리

```bash
# .env 파일은 절대 git에 커밋하지 않습니다
echo ".env" >> .gitignore

# 배포 플랫폼의 비밀 관리 기능을 사용합니다
# Railway: railway variables set KEY=VALUE
# AWS: AWS Secrets Manager 또는 Parameter Store
```

### 헬스체크

배포 플랫폼의 헬스체크를 `GET /health`로 설정합니다. 이 엔드포인트는 인증 없이 접근 가능한 유일한 엔드포인트입니다.

---

## 환경별 권장 설정

| 환경 | `MODE` | `AUTH` | `CLAUDE_MODE` | Redis |
|------|--------|--------|---------------|-------|
| 로컬 개발 | `local` | `none` | `cli` 또는 `api` | 로컬 또는 인메모리 |
| 개인 원격 서버 | `remote` | `none` | `api` | 원격 Redis |
| 팀 서버 | `remote` | `jwt` | `api` | 원격 Redis |

---

## 다음 단계

- [MCP 서버 통합](mcp-integration.md) — Claude Code 연동
- [환경변수 전체 목록](../reference/environment-variables.md) — 전체 설정 참조
- [REST API 레퍼런스](../reference/rest-api.md) — API 엔드포인트
