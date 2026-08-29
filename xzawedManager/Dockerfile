FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS shared-build
WORKDIR /workspace/xzawedShared
COPY xzawedShared/package.json xzawedShared/pnpm-lock.yaml xzawedShared/tsconfig.json ./
COPY xzawedShared/src ./src
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

FROM base AS deps
WORKDIR /app
COPY --from=shared-build /workspace/xzawedShared/dist /xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /xzawedShared/package.json
COPY --from=shared-build /workspace/xzawedShared/node_modules /xzawedShared/node_modules
COPY xzawedManager/pnpm-workspace.yaml xzawedManager/pnpm-lock.yaml xzawedManager/package.json ./
COPY xzawedManager/packages/server/package.json ./packages/server/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY xzawedManager/ .
RUN pnpm --filter @xzawed/manager-server build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/src/db/migrations ./packages/server/dist/db/migrations
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=shared-build /workspace/xzawedShared/dist /xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /xzawedShared/package.json

EXPOSE 3001
WORKDIR /app/packages/server
# 공유 workspace 볼륨의 마운트포인트를 **이미지 안에** node 소유로 만들어 둔다.
# 없으면 Docker 가 named volume 을 root:root 로 생성하고, 러너는 USER node 라 EACCES 로
# 한 줄도 못 쓴다 — 코드 생성·빌드·테스트가 전부 막힌다(실측: 7개 서비스 전부 DENIED).
RUN mkdir -p /workspace && chown node:node /workspace
USER node
CMD ["node", "dist/index.js"]
