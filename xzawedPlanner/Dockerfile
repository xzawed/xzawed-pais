FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS shared-build
WORKDIR /workspace/xzawedShared
COPY xzawedShared/package.json xzawedShared/pnpm-lock.yaml xzawedShared/tsconfig.json ./
COPY xzawedShared/src ./src
RUN pnpm install --frozen-lockfile && pnpm build

FROM base AS service-deps
WORKDIR /workspace/xzawedPlanner
COPY --from=shared-build /workspace/xzawedShared/dist /workspace/xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /workspace/xzawedShared/package.json
COPY xzawedPlanner/pnpm-lock.yaml xzawedPlanner/package.json ./
RUN pnpm install --frozen-lockfile

FROM service-deps AS service-build
COPY xzawedPlanner/src ./src
COPY xzawedPlanner/tsconfig.json ./
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=service-build /workspace/xzawedPlanner/dist ./dist
COPY --from=service-build /workspace/xzawedPlanner/package.json ./
COPY --from=service-deps /workspace/xzawedPlanner/node_modules ./node_modules

EXPOSE 3002
CMD ["node", "dist/index.js"]
