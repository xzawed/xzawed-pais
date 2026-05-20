FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS shared-build
WORKDIR /workspace/xzawedShared
COPY xzawedShared/package.json xzawedShared/pnpm-lock.yaml xzawedShared/tsconfig.json ./
COPY xzawedShared/src ./src
RUN pnpm install --frozen-lockfile && pnpm build

FROM base AS service-deps
WORKDIR /workspace/xzawedDesigner
COPY --from=shared-build /workspace/xzawedShared/dist /workspace/xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /workspace/xzawedShared/package.json
COPY xzawedDesigner/pnpm-lock.yaml xzawedDesigner/package.json ./
RUN pnpm install --frozen-lockfile

FROM service-deps AS service-build
COPY xzawedDesigner/src ./src
COPY xzawedDesigner/tsconfig.json ./
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=service-build /workspace/xzawedDesigner/dist ./dist
COPY --from=service-build /workspace/xzawedDesigner/package.json ./
COPY --from=service-deps /workspace/xzawedDesigner/node_modules ./node_modules

EXPOSE 3004
CMD ["node", "dist/index.js"]
