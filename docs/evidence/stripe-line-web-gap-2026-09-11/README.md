# LINE/web owned-billing audit evidence — 2026-09-11

**Existing-runtime repairs PASS locally. Full Stripe collection/automatic invoice apply, new billing UI, Postmark delivery and native LINE acceptance are NOT RUN / not implemented.** This is not a live-payment certification.

| Layer | Result | Evidence |
|---|---|---|
| Focused auth/LIFF/handoff/controller/buffer/webhook/actual rich-menu manifest | **565 passed, 0 failed, 0 skipped** | [test output](focused-output.txt) |
| Chromium → real web/BFF/API/PostgreSQL | **25 passed, 0 failed** | [output](browser-output.txt), [structured cases](browser-results.json) |
| Real mangmee_web bundle | **22 scenarios PASS**: 2 catalog/layout/keyboard + 20 form outcomes | [results](marketing-results.json) |
| Production-source API and web typechecks | **exit 0** | [scope/config](typecheck.txt) |
| Fixture cleanup | company/user/handoff/identity counts **0** | [counts](cleanup.json), [read-only checker](check-cleanup.ts) |

See [GW01–GW10 bug/impact/coverage](../../research/stripe-line-web-gap-closure-2026-09-11.md), [owned design](../../specs/mangmee-owned-billing-integration-spec-th.md) and [plan](../../plans/mangmee-line-web-billing-ui-plan-th.md). Every LB row has a coverage disposition; partial current-access proof is not full billing PASS.

## What the browser actually proved

- Invalid session → login → same company and query; expired/term-disabled owner recovery, employee/tenant denial, legal acceptance, 401/403/500/offline/retry and delayed company A→B.
- Actual served LIFF HTML/script prepares a single-use URL and waits for keyboard/click. A separate browser context exchanges it through the real BFF/API/DB, receives httpOnly cookies, reaches the expired company's recovery page and requires no password for a LINE-only fixture. The original LIFF context receives no web auth cookie.
- Replaying a spent token, revoking membership, severing identity or adding an admin hold refuses exchange. After the simulated payment driver calls the existing ADMIN manual-renew route, the real business page/API works; a fresh LINE handoff works and the unrelated company is unchanged.
- Marketing actual bundle renders truthful request errors for offline, HTTP 500, malformed JSON, refused success=false; only success=true shows sent. Form data remains after failure. All outbound POSTs were intercepted; no lead/email was delivered.

**Simulation boundaries:** LINE SDK/ID-proof response is a test fixture; handoff exchange/session/DB are real. Payment is the existing manual-renew driver, not a Stripe adapter. The tests do not prove real LINE verification, native app opening, Stripe Checkout/3DS/Portal, signed Stripe invoice application, or real email/LINE delivery. Separate unit tests exercise verifier/session rules and signed LINE webhook raw-body handling.

## Defect reproduction and test iteration

Five initial leaf assertions failed for inactive user classification, expired LIFF destinations and term-disabled handoff. The same suites then passed; expanded coverage adds explicit gesture/stale-link, revoked identity, reference query, selected-company routing, committed rich menu→signed controller→handler replies, buffer redelivery and all existing webhook cases.

First browser run: 21 passed / 4 failed because a test-only dynamic import pulled the contracts graph into Playwright's ESM loader (`inventory.js` not linked). The fixture now creates random token + SHA-256 with Node crypto, explicitly substituting mint setup. The next run passed 25; final rerun after the last auth/webhook changes also passed 25. No failed assertions were removed to obtain a pass.

## Reproduce

Run from mangmeeplus with the existing local seed DB/Redis. Ports 3020/3021 must be free. No package.json changes, new dependencies, Docker reset, remote operations, messages, charges or deploys are needed.

```sh
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec \
  apps/api/src/common/security/liff-start-handoff.spec.ts \
  apps/api/src/modules/auth/line-liff-signup.spec.ts \
  apps/api/src/modules/auth/line-handoff.spec.ts \
  apps/api/src/modules/auth/line-webhook.controller.spec.ts \
  apps/api/src/modules/line-ai/line-first-signup-webhook.spec.ts \
  apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts \
  apps/api/src/modules/line-ai/application/line-message-buffer.service.spec.ts \
  apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  scripts/line-oa/rich-menu-v2-ver2.manifest.spec.mjs

DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public' \
REDIS_URL='redis://127.0.0.1:6379' API_PORT=3021 WEB_PORT=3020 \
E2E_API_BASE_URL=http://127.0.0.1:3021/v1 E2E_WEB_BASE_URL=http://127.0.0.1:3020 \
NEXT_DIST_DIR=.next/line-billing-gap-3020 MODEL_PROVIDER=disabled \
LINE_WEB_HANDOFF_ENABLED=true LINE_LIFF_ID=1234567890-test \
corepack pnpm exec playwright test e2e/plan-term-billing-readiness.spec.ts \
  --project=chromium --workers=1 --retries=0 --timeout=90000 \
  --output=test-results/stripe-line-web-gap-final-2026-09-11 --reporter=list

MARKETING_FAILURE_PROOF=1 MARKETING_EVIDENCE_DIR=test-results/stripe-marketing-gap-2026-09-11 \
node e2e/stripe-marketing-readiness.mjs

NODE_OPTIONS=--max-old-space-size=12288 node_modules/.bin/tsc \
  -p docs/evidence/stripe-repair-2026-09-11/api-production.tsconfig.json --noEmit
NODE_OPTIONS=--max-old-space-size=12288 node_modules/.bin/tsc \
  -p docs/evidence/stripe-repair-2026-09-11/web-production.tsconfig.json --noEmit
```

Next rewrites `apps/web/next-env.d.ts` for the temporary output path; the generated-only change was restored after this run. Cleanup removes only disposable fixture rows, including handoff rows without a company FK; existing append-only legal evidence stays under its original retention rule. Previous/unrelated user processes and dirty files were preserved. No live OA state inspected or modified; deployed rich-menu bindings are still a device/release gate.

## Source and visual evidence

[Source hashes](source-sha256.json) record the tested dirty worktree paths and both repository base HEADs. They do not imply those changes were committed or deployed.

- [LIFF ready, 390px](liff-ready-390.png): inspected; two readable buttons, no overflow/token shown.
- [LINE browser return after simulated renewal](line-return-after-renew.png): real app view.
- [Trial offline error, 390px](trial-failure-390.png): inspected; preserved data and retry visible.
- [Contact offline error, 390px](contact-failure-390.png).
