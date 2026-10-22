FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS system
# The pinned base digest ships fixed-but-unapplied Debian CVEs; take trixie-security at build time.
RUN apt-get update -y \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM system AS build-base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM build-base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY patches ./patches
COPY apps/workers/package.json apps/workers/package.json
COPY packages/config/package.json packages/config/package.json

FROM manifests AS deps
RUN pnpm install --frozen-lockfile

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --no-optional --filter @watchdog-bms/workers...

FROM deps AS build
COPY apps/workers/src apps/workers/src
COPY apps/workers/tsconfig.json apps/workers/tsconfig.json
COPY packages/config/src packages/config/src
COPY packages/config/tsconfig.json packages/config/tsconfig.json
RUN pnpm exec turbo run build --filter=@watchdog-bms/workers

FROM build AS runtime-artifacts
RUN find apps/workers/dist packages/config/dist -type f \
  \( -name '*.map' -o -name '*.d.ts' -o -name '*.spec.js' -o -name '*-smoke.js' -o -name '*.md' \) -delete

FROM system AS runner
# No disk/partition tooling in the runtime (util-linux / CVE-2026-53615).
# Debian 13's base ships no e2fsprogs, and apt cannot resolve a name that is in neither the
# dpkg status database nor the package lists the system stage deleted: take the lists again.
RUN apt-get update -y \
  && apt-get purge -y --allow-remove-essential \
  util-linux util-linux-extra bsdutils mount libblkid1 libmount1 libsmartcols1 libuuid1 e2fsprogs login liblastlog2-2 \
  && apt-get purge -y --allow-remove-essential perl-base \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=runtime-artifacts --chown=node:node /app/apps/workers/package.json ./apps/workers/package.json
COPY --from=runtime-artifacts --chown=node:node /app/apps/workers/dist ./apps/workers/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/package.json ./packages/config/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/dist ./packages/config/dist
USER node
WORKDIR /app/apps/workers
EXPOSE 3000
CMD ["node", "dist/apps/workers/src/main.js"]
