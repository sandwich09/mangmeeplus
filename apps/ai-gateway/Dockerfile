FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS system
WORKDIR /app

FROM system AS build-base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM build-base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/ai-gateway/package.json apps/ai-gateway/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json

FROM manifests AS deps
RUN pnpm install --frozen-lockfile

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --no-optional --filter @watchdog-bms/ai-gateway...

FROM deps AS build
COPY apps/ai-gateway/src apps/ai-gateway/src
COPY apps/ai-gateway/tsconfig.json apps/ai-gateway/tsconfig.json
COPY packages/config/src packages/config/src
COPY packages/config/tsconfig.json packages/config/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
RUN pnpm exec turbo run build --filter=@watchdog-bms/ai-gateway

FROM build AS runtime-artifacts
RUN find apps/ai-gateway/dist packages/config/dist packages/contracts/dist -type f \
  \( -name '*.map' -o -name '*.d.ts' -o -name '*.spec.js' -o -name '*-smoke.js' -o -name '*.md' \) -delete

FROM system AS runner
# No disk/partition tooling in the runtime (util-linux / CVE-2026-53615).
RUN apt-get purge -y --allow-remove-essential \
  util-linux util-linux-extra bsdutils mount libblkid1 libmount1 libsmartcols1 libuuid1 e2fsprogs \
  && apt-get purge -y --allow-remove-essential perl-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/ai-gateway/node_modules ./apps/ai-gateway/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=runtime-artifacts --chown=node:node /app/apps/ai-gateway/package.json ./apps/ai-gateway/package.json
COPY --from=runtime-artifacts --chown=node:node /app/apps/ai-gateway/dist ./apps/ai-gateway/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/package.json ./packages/config/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/dist ./packages/config/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
USER node
WORKDIR /app/apps/ai-gateway
EXPOSE 3002
CMD ["node", "dist/apps/ai-gateway/src/main.js"]
