FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

FROM base AS deps
COPY xzawedOrchestrator/pnpm-workspace.yaml xzawedOrchestrator/pnpm-lock.yaml xzawedOrchestrator/package.json ./
COPY xzawedOrchestrator/packages/shared/package.json ./packages/shared/
COPY xzawedOrchestrator/packages/server/package.json ./packages/server/
COPY xzawedOrchestrator/packages/ui/package.json ./packages/ui/
COPY xzawedOrchestrator/packages/app/package.json ./packages/app/
COPY xzawedOrchestrator/packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY xzawedOrchestrator/ .
RUN pnpm --filter @xzawed/shared build && pnpm --filter @xzawed/server build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# ── Claude CLI ────────────────────────────────────────────────────────────────
# `CLAUDE_MODE=cli` 면 `claude/cli-runner.ts` 가 `spawn('claude', …, {shell:false})` 한다.
# 그 바이너리가 이미지에 없어서 **출하된 Launcher 의 기본 경로가 ENOENT 로 죽었다** —
# Launcher 사본 compose 의 기본값이 `${CLAUDE_MODE:-cli}` 이고, 컨테이너 안에서 실측한
# 결과가 `SPAWN_ERROR code=ENOENT syscall=spawn claude` 였다.
#
# **래퍼(`@anthropic-ai/claude-code`)가 아니라 플랫폼 패키지를 직접 넣는다.** 래퍼는
# `postinstall: node install.cjs` 로 네이티브 바이너리를 플레이스홀더 위에 복사하는데,
# 이 저장소는 모든 설치에 `--ignore-scripts` 를 건다(보안 불변식) — 그러면 설치는
# 성공하는데 `bin/claude.exe` 가 스텁으로 남아 **실행만 안 되는** 상태가 된다.
# 플랫폼 패키지는 postinstall 이 필요 없어 그 불변식을 지키면서 동작한다.
#
# 실측: `node:22-alpine` 55MB → 234MB(+179MB, 그중 198.7MB 가 이 패키지). 대부분이
# 네이티브 바이너리 자체라 압축·다단계로 줄일 여지가 없다.
#
# 이 스텝은 orchestrator 에만 둔다 — 컨테이너에서 `claude` 를 spawn 하는 서비스가
# 여기 하나뿐이다(Manager 가 읽는 것은 `CLAUDE_MODE` 가 아니라 `CLAUDE_MODEL` 이다).
# Launcher 의 `claude-detector.ts` 는 **호스트**에서 돈다.
#
# **버전을 고정하되, 버전 핀만으로는 내용이 고정되지 않는다.** 범위로 두면 다시 구울
# 때마다 검토되지 않은 코드가 출하물에 들어온다. 그렇다고 정확한 버전만으로 충분하지도
# 않다 — npm 은 같은 name@version 재발행을 막지만 설치는 여전히 **레지스트리가 주는**
# `dist.integrity` 를 신뢰하고, 그 값과 tarball 을 함께 바꿀 수 있는 쪽에는 무력하다.
# 이 패키지들에는 npm provenance attestation 도 없다.
#
# 그래서 sha512 를 **이 파일에 커밋해 두고** 설치 전에 대조한다. 레지스트리가 그때 주는
# 값과 비교하면 순환이라 의미가 없다. 아래 값은 tarball 을 직접 받아 잰 것이고
# 레지스트리의 `dist.integrity` 와도 일치함을 확인했다.
#
# 버전을 올릴 때는 해시도 함께 올린다 — 안 그러면 빌드가 fail-closed 로 멈춘다.
# Dependabot 은 Dockerfile 안의 이 값들을 추적하지 않으므로 손으로 올린다.
ARG CLAUDE_CODE_VERSION=2.1.251
ARG CLAUDE_SHA512_AMD64=sha512-fuELyER/KyDie/iPimqHgZauPINBb+mWoYG7dXKxaxXlqCSmSI9YHzDVQ/1zSfiUnAU3FhbT1p9GNBqwJPikqA==
ARG CLAUDE_SHA512_ARM64=sha512-VJAZGuGTaRQINdUS35qhkgZoK8R+0MciPHMG6KMTFHjLC8GKtxj47RmiWcCUAu+fJpEOsko0FLEBqvAbdOpkJg==
ARG TARGETARCH
ARG BUILDPLATFORM
ARG TARGETPLATFORM
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) PKG="@anthropic-ai/claude-code-linux-x64-musl";   WANT="$CLAUDE_SHA512_AMD64"; ELF_MACHINE=62 ;; \
      arm64) PKG="@anthropic-ai/claude-code-linux-arm64-musl"; WANT="$CLAUDE_SHA512_ARM64"; ELF_MACHINE=183 ;; \
      *) echo "지원하지 않는 TARGETARCH=$TARGETARCH — claude 바이너리를 고를 수 없다" >&2; exit 1 ;; \
    esac; \
    # **npm pack 의 stdout 을 파싱하지 않는다.** `... | tail -1` 은 `set -eu` 로도 막히지
    # 않는 구멍이다(`sh` 에 pipefail 이 없어 pack 이 죽어도 tail 이 성공하면 통과한다).
    # 빈 디렉토리에 받아 그 안의 유일한 파일을 쓰면 파싱도 파이프라인도 필요없다.
    mkdir -p /tmp/cc; \
    npm pack "${PKG}@${CLAUDE_CODE_VERSION}" --pack-destination /tmp/cc --silent >/dev/null; \
    TGZ="$(ls /tmp/cc)"; \
    if [ ! -f "/tmp/cc/$TGZ" ]; then echo "tarball 을 받지 못했다: '$TGZ'" >&2; exit 1; fi; \
    GOT="sha512-$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha512").update(f.readFileSync(process.argv[1])).digest("base64"))' "/tmp/cc/$TGZ")"; \
    if [ "$GOT" != "$WANT" ]; then echo "claude 바이너리 무결성 불일치" >&2; echo "  기대: $WANT" >&2; echo "  실제: $GOT" >&2; exit 1; fi; \
    npm install -g --ignore-scripts "/tmp/cc/$TGZ"; \
    rm -rf /tmp/cc; npm cache clean --force; \
    BIN="/usr/local/lib/node_modules/${PKG}/claude"; \
    # 플랫폼 패키지는 `bin` 을 선언하지 않는다(래퍼가 그 역할을 했다) — 직접 링크한다.
    ln -sf "$BIN" /usr/local/bin/claude; \
    # **실행 검증은 네이티브 빌드에서만 한다.** 크로스 빌드는 QEMU 에뮬레이션이라 208MB
    # 네이티브 바이너리를 돌리면 이 저장소가 이미 물린 `signal 4 (Illegal instruction)` 를
    # 다시 부른다. 에뮬레이션에서는 ELF 헤더로 "맞는 아키텍처의 실행 파일인가"만 본다.
    node -e 'const f=require("fs");const b=Buffer.alloc(20);const d=f.openSync(process.argv[1],"r");f.readSync(d,b,0,20,0);f.closeSync(d);if(b.subarray(0,4).toString("binary")!=="\x7fELF")throw new Error("ELF 가 아니다");const m=b.readUInt16LE(18);if(m!==Number(process.argv[2]))throw new Error("e_machine 불일치: "+m+" != "+process.argv[2]);console.log("ELF ok e_machine="+m)' "$BIN" "$ELF_MACHINE"; \
    if [ "$BUILDPLATFORM" = "$TARGETPLATFORM" ]; then claude --version; else echo "크로스 빌드($BUILDPLATFORM -> $TARGETPLATFORM) — 실행 검증은 건너뛰고 ELF 검증만 했다"; fi

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules

EXPOSE 3000
WORKDIR /app/packages/server
# 공유 workspace 볼륨의 마운트포인트를 **이미지 안에** node 소유로 만들어 둔다.
# 없으면 Docker 가 named volume 을 root:root 로 생성하고, 러너는 USER node 라 EACCES 로
# 한 줄도 못 쓴다 — 코드 생성·빌드·테스트가 전부 막힌다(실측: 7개 서비스 전부 DENIED).
RUN mkdir -p /workspace && chown node:node /workspace
USER node
CMD ["node", "dist/index.js"]
