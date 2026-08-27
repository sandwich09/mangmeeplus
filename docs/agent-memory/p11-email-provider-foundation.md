# Agent Memory: P11 Email Provider Foundation

Status: ROOT FOLLOW-UP ACCEPTED / LOCAL VERIFIED — explicit SES frontend-base fix reviewed and full API rerun passed; phase commit/PR/CI pending. No activation.
Owner: Root integration; original bounded implementation by phase6_launch_review; explicit SES frontend-base follow-up by `/root/ocr_platform_admin`.
Scope: Only SES auth-mailer runtime/config/dependency patch from `ec03bc6f`, scoped P11 docs and exact maintenance pins. Initial baseline `21f109d51e91d96836aaa3423730072378e977b7`, fast-forwarded to `111532966c415fee11abb36ca1749bf1fc66ee52` after expense PR287; branch `codex/p11-ses-foundation-current`.

Decisions:
- Keep EMAIL_PROVIDER default/config disabled; no real mail/cloud/browser/DB calls.
- Console requires explicit local-console + APP_ENV=local; disabled is a true no-op, including local.
- SES missing config fails selection; HTTPS validates before sending. Adapter failures propagate; no durable retry is claimed.
- Add claim mail shape only: no caller/producer/route/page/schema. Existing account email change/resend already use the mailer, so provider activation would change live behavior and is outside this port.
- Preserve current spec's configuration-set, bounce/complaint and suppression requirements. Retain `384d72a5` durable-secret gate without selecting a representation.
- Do not copy PR272 P9/P10 stack or overwrite root's frozen eight-file capture audit/master/closure plans.
- Maintenance generator inspected: writes only `infra/security/validate-production-maintenance-release.sh` and `.github/workflows/deploy-production.yml`; only exact reviewed source hashes may change.

Open questions:
- Durable raw-link/key lifecycle, claim TTL and resend/revoke authority (P10 §8).
- Sender domain/DNS owner/region, sandbox/production access and live delivery/bounce/complaint/suppression evidence. No choices made by this port.

Artifacts:
- [P11 spec](../specs/mangmee-email-delivery-claim-spec-th.md), [P11 plan](../plans/mangmee-email-delivery-claim-plan-th.md), [ADR-0009](../adr/0009-auth-security-email-delivery.md).
- Original [PR272](https://github.com/MangmeeDev/mangmeeplus/pull/272), head `384d72a5720a58efde943831124e85765ebbc5cb`, still OPEN at audit; CI [32979173978](https://github.com/MangmeeDev/mangmeeplus/actions/runs/32979173978) FAILURE at maintenance pin check, downstream tests skipped.

Verification:
- Pre-port read-only review: all eleven existing code/config/test/dependency preimages match develop `21f109d5`; new SES adapter is the twelfth runtime/config/dependency file.
- Original PR-head tests rerun locally: config 137/137, auth 34/34 (provider 5/5), zero skip. Auth test reused an existing generated Prisma client through an in-memory resolver with HTTP/TCP/fetch denied; this is not current-base build/DI evidence.
- Current-base `corepack pnpm install --offline --frozen-lockfile --ignore-scripts`: PASS, 754 reused, 0 downloaded. Only package change is direct `@aws-sdk/client-ses: ^3.1083.0`; existing lock resolves SES 3.1118.0. No script/metadata edits.
- `corepack pnpm --filter @watchdog-bms/api exec prisma generate`: PASS using this worktree's schema; generated files stay ignored and no migration/database operation ran.
- `corepack pnpm --filter @watchdog-bms/config build`, `corepack pnpm --filter @watchdog-bms/contracts build`, `corepack pnpm --filter @watchdog-bms/api build`: PASS.
- `EMAIL_PROVIDER=disabled AWS_EC2_METADATA_DISABLED=true corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/auth/auth-endpoints.spec.ts src/modules/auth/application/use-cases/forgot-password-reset.use-case.spec.ts`: 43/43 PASS, 0 skip (provider 5/5). Assertions additionally cover local/non-local disabled, each missing/empty SES config key, recipient and all UTF-8 charsets.
- `corepack pnpm --filter @watchdog-bms/config test`: 137/137 PASS, 0 skip, including default disabled.
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/spec-suite-coverage.spec.ts src/common/security/injectable-di-token.spec.ts`: 6/6 PASS, 0 skip.
- `corepack pnpm --filter @watchdog-bms/api typecheck` and `corepack pnpm --filter @watchdog-bms/config typecheck`: PASS.
- Built `boot-di-smoke.js`: PASS twice with isolated environment, first disabled without SES fields, then synthetic complete SES config (`ap-southeast-1`, `no-reply@example.com`, `https://app.example.com`). HTTP/HTTPS request, TCP connect and fetch were replaced with throwing functions before loading the built script; no network I/O occurred. Fixture values are not sender/region approval.
- `node infra/security/sync-production-maintenance-release-pins.mjs --check`, `bash infra/security/sync-production-maintenance-release-pins.spec.sh`, `bash infra/security/validate-production-maintenance-release.spec.sh`: PASS. Generator changes only auth-module hash `d8a17eb75125f7555c9beb78504ad438a72f25a08718994f12a6dab2afa3da41` and resulting validator hash `0f5c6dd3d02d2f9cc037039f6503277daf8765224ca3300fe593ae01f9adf102`; all 45 exact-file pins remain enforced.
- `git diff --check` and P11 relative-doc-link check: PASS. Full API suite/new CI/browser/live delivery not run in this bounded handoff; no claim of inbox/DKIM or human acceptance.

Next:
- Root reviews frozen diff, integrates onto latest develop and runs required CI before delivery. Keep Phase 1–4 and activation blocked; root owns master/closure status integration and disposition of old stacked PR272. Do not copy its unrelated P9/P10 commits.

## Root/Opus follow-up — explicit SES frontend base

- Root supplied actual Claude CLI 2.1.237 provenance: `--model claude-opus-5 --effort max
  --safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep
  --no-chrome --no-session-persistence --output-format json`; exit 0 / `is_error: false`,
  session `284d115d-cbfd-492d-96d3-988e734de62b`, result UUID
  `cc32de2c-9843-40b6-b453-eb5ac14f09e1`, about 286s. Main modelUsage confirms
  `claude-opus-5`; auxiliary Haiku metadata accounts for 22 tokens. Verdict: APPROVE for
  bounded Phase 0 conditional on exact-head CI, with an activation-medium explicit WEB
  base finding root elected to fix now. This verdict predates the new fix, not blanket
  approval. Its earlier full-API-not-run statement was stale: root's completed full API
  evidence is retained below and must not be replaced by that statement.
- Verified `AppConfigService.webBaseUrl` falls back to PUBLIC_BASE_URL (API origin), so
  using it in SES factory/adapter bypasses the intended explicit frontend requirement.
  Add SES-only `sesWebBaseUrl` (WEB_BASE_URL only), use it at factory/adapter boundaries,
  and require WEB_BASE_URL in SES production validation. Preserve general/local-console
  fallback, default disabled, HTTPS-before-send and all existing root changes.
- Scope excludes provider activation/cloud/DB/browser, other Opus notes, package changes,
  claim caller/policy, configuration sets and Phase 1–4. Regenerated exact pins only with
  the existing reviewed generator. The same 18 dirty candidate files are retained; this
  follow-up did not change the inherited package/lockfile/.env/ADR/port/console/disabled
  adapter edits or touch the frozen AI worktree.
- Red checks before implementation: config **137/138**, one new explicit-base regression
  failed; auth/reset **40/44**, four provider-boundary cases failed after their fixtures
  distinguished public API versus explicit frontend URLs. The real-getter test uses the
  AppConfigService prototype with a synthetic config record, not a rewritten fake getter
  or mutated process.env; the compiled boot checks below also exercise real construction.
- Final commands/results:
  - `pnpm --filter @watchdog-bms/config build` and `pnpm --filter @watchdog-bms/config test`:
    **138/138**, zero skip.
  - `env -u DATABASE_URL -u TEST_DATABASE_URL -u SHADOW_DATABASE_URL EMAIL_PROVIDER=disabled
    AWS_EC2_METADATA_DISABLED=true pnpm --filter @watchdog-bms/api exec tsx --test
    --test-reporter=spec src/modules/auth/auth-endpoints.spec.ts
    src/modules/auth/application/use-cases/forgot-password-reset.use-case.spec.ts
    src/spec-suite-coverage.spec.ts src/common/security/injectable-di-token.spec.ts`:
    **50/50**, zero skip (auth/reset **44**, DI/registration **6**).
  - API/config `typecheck`, contracts/API `build`: **passed**.
  - `node infra/security/sync-production-maintenance-release-pins.mjs`, the same with
    `--check`, `bash infra/security/sync-production-maintenance-release-pins.spec.sh`, and
    `bash infra/security/validate-production-maintenance-release.spec.sh`: **passed**.
    All **45** exact-file pins remain; auth-module SHA-256 is
    `e24b743b142b28bf9a91f78ef6ce9321e8ae4db9c02ed1cc8df5ab922ec8ec4d`, validator/workflow
    SHA-256 is `5c1abcf7a5816993fa9d47e6bd8907c080cdfd779e43e24004f0052617b1a322`.
  - `git diff --check`: **passed**. No post-fix full API run is claimed here; root owns
    that final integration check and CI. The pre-fix full API evidence below stays valid
    only for its earlier source, not as blanket approval of this follow-up.
- Compiled `apps/api/dist/apps/api/src/scripts/boot-di-smoke.js` ran in four isolated Node
  subprocesses. Each environment contains only PATH, AWS_EC2_METADATA_DISABLED=true,
  PUBLIC_BASE_URL=https://api.example.com and the listed synthetic SES fields; boot smoke
  supplies its own local/unreachable DB defaults. Before requiring the built script,
  HTTP/HTTPS request/get, net connect/createConnection/Socket.connect, TLS connect and fetch
  were replaced by throwing guards. Attempt count forces exit 97 even if a caller catches
  the error. Results: default disabled without WEB/SES fields **exit 0**; SES with region
  ap-southeast-1/from no-reply@example.com/WEB https://frontend.example.com **exit 0**;
  SES with the same region/from and missing WEB **exit 1** (factory required-config error);
  SES with empty WEB **exit 1** (schema error names WEB_BASE_URL). Every case had **zero
  network attempts**. These fixtures do not select/approve a sender, region or real URL.
- Source is refrozen for root final review. No provider traffic, cloud/DB/browser action,
  commit, push, PR, activation or customer email occurred.

## Root integrated verification — 2026-08-27

- Reviewed the current spec/plan, adapter/port/factory/config and registered test changes. Independent read-only review found no concrete P0/P1/P2 in this disabled-safe slice. Current caller DTOs validate recipient email; the adapter uses structured SES fields, not raw MIME. This does not approve a future claim caller or provider activation.
- Compared all 30 incoming PR287 paths to the 18 candidate paths: no overlap. Fast-forwarded this worktree to `11153296` without stash/reset or overwriting candidate changes; regenerated Prisma against an explicit unreachable local generation-only URL. No migration or DB connection occurred.
- Rebuilt contracts/config/API and reran API/config typechecks and exact maintenance-pin check: PASS. Only the reviewed auth-module digest and its parent validator digest change; 45 exact-file pins remain enforced.
- `env -u DATABASE_URL -u TEST_DATABASE_URL -u SHADOW_DATABASE_URL EMAIL_PROVIDER=disabled AWS_EC2_METADATA_DISABLED=true pnpm --filter @watchdog-bms/api test`: PASS. Repeated the same registered pretest/default test commands with only the reporter changed in memory to TAP for exact counts: pretest **16 passed / 30 total, 14 skipped**; default API **5324 passed / 5422 total, 98 skipped**, zero failures. Skipped integration cases are not claimed as tested PostgreSQL/live-provider behavior.
- Config default suite: **137/137**, zero skipped. Current-source auth/reset **43/43** independently rerun with network denied; config-only review **133/133** excludes the additional four manifest tests in the default 137-case suite.
- Compiled DI smoke repeated with a minimal synthetic environment and HTTP/HTTPS/TCP/TLS/fetch functions replaced by throwing guards before loading the application: disabled **145ms**, synthetic SES **122ms**, both exit 0 and empty stderr. Synthetic sender/region/base URL are fixtures, not Owner choices. No email, cloud, browser, provider traffic or database mutation.
- Historical launch: actual Claude CLI `claude-opus-5 --effort max` was started with read-only tools and no browser/shell. It subsequently returned conditional **APPROVE** with the explicit-frontend activation finding; exact provenance is recorded above. That verdict predates this follow-up fix, so root post-fix review/tests and exact-head CI remain required.

## Root post-fix acceptance — 2026-08-27

- Independently reviewed the new SES-only getter, factory/adapter consumption, production
  config guard and registered real-getter regression. General web/local-console fallback
  remains unchanged. The original `.env.example` already had an empty SES_FROM_ADDRESS;
  that Opus note was not introduced by this diff. Lazy client construction did not dial
  in the network-denied boots; future claim-input and configuration-set work stays gated.
- Reran registered pretest/default API scripts with the TAP reporter in memory, the same
  explicit disabled provider and DB env removals recorded above: pretest **16/30 passed,
  14 skipped**; default API **5325/5423 passed, 98 skipped**, zero failures. This is the
  final source, including the explicit frontend fix; earlier counts remain historical.
- Reviewed focused auth/reset+DI50/50, config138/138 and all four network-denied boot
  outcomes; exact 45-file maintenance pin check and diff check independently PASS.
  Root accepts this disabled-safe source slice for phase PR/CI, not main or activation.
- Before commit, fast-forwarded to `9aaacfe2617f83f1bd10e941580ee2cc8dc2b396`
  (docs-only PR289 / CI33040756154 SUCCESS). All 11 incoming Markdown paths were disjoint
  from this candidate; tested runtime/config/dependency bytes are unchanged. No stash/reset.
