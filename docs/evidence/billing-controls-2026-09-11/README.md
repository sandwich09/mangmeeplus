# Billing controls local evidence — 2026-09-11

Status: **LOCAL REPAIR PASS; SPEC/PLAN C01–C08 COMPLETE; target control-suite CT01–CT32 NOT IMPLEMENTED/NOT RUN**. No deploy, external messages, Stripe charge or live gate changes. See [plan](../../plans/mangmee-billing-controls-plan-th.md) and [impact](../../research/billing-controls-impact-2026-09-11.md).

## Results and limits

| Check | Observed result | What this proves |
|---|---|---|
| Auth/session focused tests | **26/26 PASS** | system/company sanitizer, landing, legal/password helper and recovery contracts; no external/open redirect |
| BC browser final run | **5/5 PASS**, 0 skipped/flaky, 21.2s | BC01 exact admin return desktop/390px + no duplicate React key, BC02 read outage→manual retry→real API without mutation, BC03 webAdminrenew→customerweb+LINEbridge, BC04 OWNER denied admin/API |
| BC02 screenshot recheck | **1/1 PASS**, 13.6s; same case rerun, not sixth unique case | scroll error/retry into viewport to inspect the actual mobile recovery UI |
| Production web source typecheck | **exit 0** | current web TS/TSX under scoped production config; not a claim that unrelated tests typecheck |
| Cleanup | **0 companies/users/handoffTokens/externalIdentities** | disposable `e2e-billing-*` fixtures removed; legal append-only records follow existing harness |
| Docs across both repos | **14 documents / 156 local links / C01–08, CT01–32, CG01–19** | local file presence and ID coverage; not external link or runtime verification |
| No service restart during BC03 | API PID **28768**, web PID **28862**, identical before/after | existing admin term update took effect in actual DB/API/customer contexts without restarting services |

Source repair: `SystemLayout` reads trusted proxy path and uses shared safe system fallback for signed-out/password/legal gates; `PlanTermSection` has read retry/loading; its React key is distinct from sibling AI budget section. BC01 runs actual login with expired cookie. Password/legal helper behavior is focused evidence; no new dedicated browser password-change/legal journey claimed in this run.

BC03 uses the **existing manual admin renewal UI**, not Stripe. Fixtures create expired companies and substitute LINE identity proof/handoff token before the measured mutation; real BFF/API/DB/session/business pages follow. No DB direct writes during the measured admin renewal→customer return. We assert one renewal, released expiry marker, other company unchanged and actual branches page available. This does not prove network-lost renewal retry is safe (CG03 remains implementation work), paid invoice→apply, new policies/catalog revisions, provider webhook delivery, or native LINE.

CT01–CT32 remain NOT RUN. Same-PID evidence here is for existing term admin only; future C05/C06 acceptance must additionally prove desired/observed revision through API/worker/provider fixture/marketing/LINE. Initial local build/start occurs before the measured browser flow. Prior 565/25/22 counts are separate evidence, not new control-suite passes.

First run: 4 passed, 1 failed. Fault fixture failed only the first read; development mounting issued another read which succeeded before the retry button assertion. The final fixture holds read outage until explicit retry, then passes through to actual API. First run also exposed duplicate sibling React keys; fixed and added browser console assertions. [First run report](first-run-results.json) and [log](first-run.log) are retained; traces with local auth are left in ignored test-results, not added to docs.

## Reproduction

Use existing local PostgreSQL/Redis and seeded accounts. Suite guards API/web/DB loopback and creates/cleans disposable fixtures. No reseed or external service mutation needed.

```sh
node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/common/auth/session-gate.logic.spec.ts

DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public' \
REDIS_URL='redis://127.0.0.1:6379' API_PORT=3021 WEB_PORT=3020 \
E2E_API_BASE_URL=http://127.0.0.1:3021/v1 E2E_WEB_BASE_URL=http://127.0.0.1:3020 \
NEXT_DIST_DIR=.next/billing-controls-3020 MODEL_PROVIDER=disabled \
LINE_WEB_HANDOFF_ENABLED=true LINE_LIFF_ID=1234567890-test \
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/mangmee-controls-e2e-results.json \
corepack pnpm exec playwright test e2e/plan-term-billing-readiness.spec.ts \
  --project=chromium --workers=1 --retries=0 --timeout=90000 --grep 'BC0' \
  --output=test-results/billing-controls-2026-09-11-final --reporter=list,json

NODE_OPTIONS=--max-old-space-size=12288 node_modules/.bin/tsc \
  -p docs/evidence/stripe-repair-2026-09-11/web-production.tsconfig.json --noEmit

DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public' \
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json docs/evidence/stripe-line-web-gap-2026-09-11/check-cleanup.ts

python3 docs/evidence/billing-controls-2026-09-11/verify-docs.py
```

Visual recheck uses the same env/command with `--grep 'BC02'`, output `test-results/billing-controls-2026-09-11-visual` and report `/tmp/mangmee-controls-visual-results.json`. Saved and restored the original `apps/web/next-env.d.ts` around runs; temporary API/web processes exited. No `package.json` change.

## Artifacts

- [Final browser report](browser-results.json), [browser log](browser.log), [focused tests](focused.log), [typecheck output](web-types.log).
- [Same service processes](same-service-processes.json), [cleanup](cleanup.json), [source hashes](source-snapshot.json), [document/contract check](doc-check.json).
- [Mobile retry visible](read-error-with-exit-mobile.png), [read recovered](read-recovered-mobile.png), [visual recheck report](visual-recheck-results.json).
- [Control spec](../../specs/mangmee-billing-controls-spec-th.md), [plan](../../plans/mangmee-billing-controls-plan-th.md), [CG01–CG19 impacts](../../research/billing-controls-impact-2026-09-11.md). Both repos link to these contracts; marketing runtime is unchanged this turn.
