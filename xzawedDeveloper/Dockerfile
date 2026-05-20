FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS shared-build
WORKDIR /workspace/xzawedShared
COPY xzawedShared/package.json xzawedShared/pnpm-lock.yaml xzawedShared/tsconfig.json ./
COPY xzawedShared/src ./src
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

FROM base AS service-deps
WORKDIR /workspace/xzawedDeveloper
COPY --from=shared-build /workspace/xzawedShared/dist /workspace/xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /workspace/xzawedShared/package.json
COPY xzawedDeveloper/pnpm-lock.yaml xzawedDeveloper/package.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM service-deps AS service-build
COPY xzawedDeveloper/src ./src
COPY xzawedDeveloper/tsconfig.json ./
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=service-build /workspace/xzawedDeveloper/dist ./dist
COPY --from=service-build /workspace/xzawedDeveloper/package.json ./
COPY --from=service-deps /workspace/xzawedDeveloper/node_modules ./node_modules

EXPOSE 3003
CMD ["node", "dist/index.js"]
