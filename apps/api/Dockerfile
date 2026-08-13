FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS system
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates openssl fontconfig fonts-noto-core \
  && fc-cache -f \
  && fc-match -f '%{file}\n' 'Noto Sans Thai' | grep -q 'NotoSansThai' \
  && fc-list :lang=th family | grep -q . \
  && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem
RUN chmod 0644 /etc/ssl/certs/aws-rds-global-bundle.pem
WORKDIR /app

FROM system AS build-base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM build-base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json

FROM manifests AS deps
RUN pnpm install --frozen-lockfile

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --no-optional --filter @watchdog-bms/api...

FROM deps AS build
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/src apps/api/src
COPY apps/api/.swcrc apps/api/.swcrc
COPY apps/api/start-production.sh apps/api/start-production.sh
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY packages/config/src packages/config/src
COPY packages/config/tsconfig.json packages/config/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
RUN pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma
RUN pnpm exec turbo run build --filter=@watchdog-bms/api

FROM build AS local
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["sh", "start-production.sh"]

FROM build AS runtime-artifacts
RUN find apps/api/dist packages/config/dist packages/contracts/dist -type f \
  \( -name '*.map' -o -name '*.d.ts' -o -name '*.spec.js' -o -name '*-smoke.js' -o -name '*.md' \) -delete

# One-shot migration/rehearsal tooling. This target is never a service image: it exposes no port,
# has no health check and fails unless an ECS task supplies an explicit reviewed command. Its
# base must match the native Prisma schema engine installed in the Debian build stage.
FROM system AS migration-tool
COPY --from=build --chown=node:node /app /app
RUN apt-get purge -y --auto-remove fontconfig fonts-noto-core \
  && apt-get purge -y --allow-remove-essential perl-base \
  && rm -rf /var/lib/apt/lists/* \
  && chmod 1777 /tmp
VOLUME ["/tmp"]
ARG GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA \
      com.watchdog-bms.image-purpose=production-a5-migration-tool
ENV NODE_ENV=production
USER node
WORKDIR /app
CMD ["sh", "-c", "echo 'migration-tool requires an explicit one-shot command' >&2; exit 64"]

# Release orchestration needs the same Prisma/tsx source tree but remains a separately labelled,
# signed artifact in the API repository. It deliberately inherits the scanned one-shot runtime
# instead of the development-oriented `local` image.
FROM migration-tool AS release-task
ARG GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA \
      com.watchdog-bms.image-purpose=production-release-task
CMD ["sh", "-c", "echo 'release-task requires an explicit one-shot command' >&2; exit 64"]

FROM system AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=runtime-artifacts --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=runtime-artifacts --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/package.json ./packages/config/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/dist ./packages/config/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=deps /app/node_modules/.pnpm/@img+sharp-linux-x64@0.35.3/node_modules/@img/sharp-linux-x64 /tmp/sharp-native/sharp-linux-x64
COPY --from=deps /app/node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.2/node_modules/@img/sharp-libvips-linux-x64 /tmp/sharp-native/sharp-libvips-linux-x64
RUN sharp_dir="$(readlink -f './apps/api/node_modules/sharp')" \
  && mkdir -p "$sharp_dir/node_modules/@img" \
  && cp -a /tmp/sharp-native/. "$sharp_dir/node_modules/@img/" \
  && rm -rf /tmp/sharp-native \
  && node -e "require('./apps/api/node_modules/sharp')"
USER node
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/apps/api/src/main.js"]
