FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS shared-build
WORKDIR /workspace/xzawedShared
COPY xzawedShared/package.json xzawedShared/pnpm-lock.yaml xzawedShared/tsconfig.json ./
COPY xzawedShared/src ./src
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

FROM base AS service-deps
WORKDIR /workspace/xzawedBuilder
COPY --from=shared-build /workspace/xzawedShared/dist /workspace/xzawedShared/dist
COPY --from=shared-build /workspace/xzawedShared/package.json /workspace/xzawedShared/package.json
COPY xzawedBuilder/pnpm-lock.yaml xzawedBuilder/package.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM service-deps AS service-build
COPY xzawedBuilder/src ./src
COPY xzawedBuilder/tsconfig.json ./
RUN pnpm build

FROM node:22-alpine AS runner
ENV COREPACK_HOME=/opt/corepack-cache
RUN mkdir -p /opt/corepack-cache && \
    corepack enable && \
    corepack prepare pnpm@10 --activate && \
    chown -R node:node /opt/corepack-cache
WORKDIR /app
COPY --from=service-build /workspace/xzawedBuilder/dist ./dist
COPY --from=service-build /workspace/xzawedBuilder/package.json ./
COPY --from=service-deps /workspace/xzawedBuilder/node_modules ./node_modules

EXPOSE 3006
USER node
CMD ["node", "dist/index.js"]
