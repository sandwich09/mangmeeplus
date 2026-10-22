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
COPY --from=prod-deps --chown=node:node /app/apps/ai-gateway/node_modules ./apps/ai-gateway/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=runtime-artifacts --chown=node:node /app/apps/ai-gateway/package.json ./apps/ai-gateway/package.json
COPY --from=runtime-artifacts --chown=node:node /app/apps/ai-gateway/dist ./apps/ai-gateway/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/package.json ./packages/config/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/config/dist ./packages/config/dist
COPY --from=runtime-artifacts --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=runtime-artifacts --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
# The production install omits optional packages; retain only sharp's Linux runtime like the API.
COPY --from=deps /app/node_modules/.pnpm/@img+sharp-linux-x64@0.35.5/node_modules/@img/sharp-linux-x64 /tmp/sharp-native/sharp-linux-x64
COPY --from=deps /app/node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64 /tmp/sharp-native/sharp-libvips-linux-x64
RUN sharp_dir="$(readlink -f './apps/ai-gateway/node_modules/sharp')" \
  && mkdir -p "$sharp_dir/node_modules/@img" \
  && cp -a /tmp/sharp-native/. "$sharp_dir/node_modules/@img/" \
  && rm -rf /tmp/sharp-native \
  && node -e "const sharp=require('./apps/ai-gateway/node_modules/sharp');sharp({create:{width:4,height:2,channels:3,background:'white'}}).rotate(90).jpeg().toBuffer({resolveWithObject:true}).then(({info})=>{if(info.width!==2||info.height!==4)throw new Error('Receipt orientation runtime check failed');}).catch(error=>{console.error(error);process.exit(1);});"
USER node
WORKDIR /app/apps/ai-gateway
EXPOSE 3002
CMD ["node", "dist/apps/ai-gateway/src/main.js"]
