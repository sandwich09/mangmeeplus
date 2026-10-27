# Halloween security remediation — 2026-10-28

Status: COMPLETE_LOCAL. Owner authorized website vulnerability fixes only, preserving the client-side entertainment game. No participant records, signed draw/image verification, reward validation, application feature changes or deployment.

## Changes

Five dependency files changed: root, API, web and shared-config package manifests plus pnpm-lock.yaml. Existing scripts/metadata were preserved. No application source compatibility edits were required. Existing Halloween work in this checkout is separate and preserved.

| Dependency | Final resolved version | Purpose |
| --- | --- | --- |
| Next.js | 16.4.3 | Address reported framework advisories |
| Zod | 4.6.7 | Patched collection validation; existing config behavior tested before/after |
| body-parser | 2.4.0 | Compressed request handling advisory |
| multer | 2.5.0 | Upload handling advisory |
| SWC CLI | 0.8.1 | Supported updated download/archive dependency chain |
| piscina | 4.9.4 | Build-tool advisory |
| brace-expansion | 5.0.12 | Reported expansion advisory |
| http-cache-semantics | 4.3.0 | Maintained release outside reported affected range; upstream disputes advisory |

SWC now uses its official supported bin-wrapper14/downloader16/archive-type8/decompress11/file-type21 chain. A forced file-type update against older consumers was rejected after a real TAR.GZ compatibility failure. See [dependency smoke details](dependency-smoke.md), including the http-cache-semantics advisory caveat and primary sources. No advisory was suppressed.

## Verification

| Check | Result / evidence |
| --- | --- |
| Full dependency audit | 0 known findings of any severity: [raw JSON](audit-after-all.json) |
| Production dependency audit | 0 known findings of any severity: [raw JSON](audit-after-prod.json) |
| Reproducible installation | `corepack pnpm install --frozen-lockfile --offline` passed |
| Config validation | 155 tests passed before and after Zod update: [before](config-before.log), [after](config-after.log) |
| Web security and Halloween | 50 tests passed: [log](web-security-game-tests.log) |
| Gateway HTTP/security | 21 tests passed: [log](gateway-http-tests.log) |
| API upload/security | 87 tests passed: [log](api-upload-security-tests.log) |
| Actual request parser | Valid JSON/gzip, malformed JSON/trailer, size limit and continued health passed: [results](parser-smoke.json), [runnable script](parser-smoke.mjs) |
| Actual archive/SWC behavior | TAR, TAR.GZ, TAR.BZ2, ZIP extraction and SWC directory compile/runtime passed: [log](dependency-smoke.log), [script](dependency-smoke.mjs) |
| Config, gateway, workers builds | Passed: [config](config-build.log), [gateway](gateway-build.log), [workers](workers-build.log) |
| API build and standalone typecheck | Passed: [build](api-build-with-generated-client.log), [typecheck](api-typecheck-after-generate.log) |
| Web production build and standalone typecheck | Passed on Next16.4.3: [build](web-build.log), [typecheck](web-typecheck.log) |
| Production build surface | No Server Actions in node/edge manifests; cacheComponents false; sharp0.35.5: [JSON](production-build-security-surface.json) |
| Browser 390 and1280 | Draw/reveal/save/copy, direct card route, theme-off entry and direct-route gate passed: [results](browser-results.json), [390 screenshot](game-390.png), [1280 screenshot](game-1280.png) |

313 focused tests passed after updates, excluding the repeated pre-update config baseline. Relevant test commands:

```sh
# From apps/web
corepack pnpm exec tsx --test src/common/security/security-headers.logic.spec.ts src/common/auth/middleware.logic.spec.ts src/common/auth/proxy.spec.ts src/features/public-home/home-theme.server.spec.ts src/features/public-home/home-events.spec.ts src/features/public-home/home-halloween-cards.spec.ts src/features/public-home/home-halloween-provenance.spec.ts src/features/public-home/home-halloween-share.spec.ts src/features/public-home/home-halloween-countdown.spec.ts
# From apps/ai-gateway
corepack pnpm exec tsx --test src/common/security/internal-secret.spec.ts src/common/http/production-maintenance.middleware.spec.ts
# From apps/api
corepack pnpm exec tsx --test src/common/pipes/body-validation-coverage.spec.ts src/common/security/api-rate-limit.guard.spec.ts src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.spec.ts src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.spec.ts src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts
```

The first API typecheck failed because this worktree lacked generated Prisma types. Local `prisma generate` with a dummy localhost datasource generated the client; no database connection or migration was performed. [Generation log](prisma-generate.log) and successful rerun are retained, as is the initial failure log for diagnosis. Web build ignores TypeScript errors by existing project configuration, so a separate `tsc --noEmit --incremental false` was explicitly required and passed.

The actual save downloaded `mangmee-17-turbo-granny.png`; read-back found the existing mangmeeplus.com/card17/card-variant label, without authentication or personal data. Clipboard content matched the revealed Granny identity/quote and homepage plus official LINE URLs. The copy automation initially returned an earlier clipboard value; a fresh button click/read produced the correct text. All22 approved runtime artwork hashes were rechecked unchanged. Temporary browser tab closed and viewport restored. Local dev preview restarted with Next16.4.3 on43841; no API/gateway/backend was started.

## Limits and next state

- These are local source/dependency and bounded runtime checks, not a penetration test or guarantee against every attack. Audit0 means no advisories reported for this graph at check time.
- Physical iPhone/Android native share sheets and actual Facebook/Instagram/TikTok posting were not exercised; no external posts/messages were sent.
- API retains its existing `inflate:false`; gateway compressed request contract is unchanged and tested with the patched parser. Authentication, permission, CSRF, CSP, audit and rate-limit boundaries are unchanged.
- Client-side draw/countdown can be changed by a player; public card assets, including SECRET, remain public after theme-off. The image source label is unsigned and can be copied or stripped. These are accepted limits for the current no-prize game.
- No live infrastructure, WAF, deployed runtime or traffic load was inspected. No commit, push or deployment. A future release must follow the mandatory UAT/production runbook and verify the deployed artifact separately.

The owner's verification-system question was answered conceptually: a server could draw and sign a result with a private key, with a public verification page and optional signed image digest. It adds a network roundtrip and signing-key operations; verification URLs/QR are more portable than metadata through social recompression. It does not prevent repeated draws or copied cards without additional identity/replay controls. No such feature was implemented.
