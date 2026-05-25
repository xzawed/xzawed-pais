FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS shared-build
WORKDIR /workspace/xzawedShared
COPY xzawedShared/package.json xzawedShared/pnpm-lock.yaml xzawedShared/tsconfig.json ./
COPY xzawedShared/src ./src
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

FROM base AS service-deps
WORKDIR /workspace/xzawedSecurity
COPY --from=shared-build /workspace/xzawedShared/dist /workspace/xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /workspace/xzawedShared/package.json
COPY xzawedSecurity/pnpm-lock.yaml xzawedSecurity/package.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM service-deps AS service-build
COPY xzawedSecurity/src ./src
COPY xzawedSecurity/tsconfig.json ./
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=service-build /workspace/xzawedSecurity/dist ./dist
COPY --from=service-build /workspace/xzawedSecurity/package.json ./
COPY --from=service-deps /workspace/xzawedSecurity/node_modules ./node_modules

EXPOSE 3008
USER node
CMD ["node", "dist/index.js"]
