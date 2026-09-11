# Agent Memory: Stripe simulated readiness

> Latest state: [implemented repair + local proof](stripe-access-repair-2026-09-11.md). Historical notes below are preserved; S-pre is now complete and Stripe provider E2E remains NOT RUN.


Status: VERIFICATION COMPLETE — readiness FAIL; 5 product blockers confirmed, no runtime fix in this task.

Follow-up: Owner asked to fix plan/spec and finish the review. See `docs/agent-memory/stripe-plan-spec-closure-2026-09-11.md` for the completed documentation handoff, S-pre and added regression requirements. Original source/test hashes and results remain unchanged; R07 is an additional static risk, not a sixth executed failure.
Owner: thawatchai + Codex
Scope: Owner requested executable verification before Stripe integration and permits simulation. Test real existing plan-term/browser/API/DB paths with a test-only payment-outcome driver; identify unimplemented Stripe boundaries and reproduce recovery/concurrency gaps. Do not treat simulated/manual renewal as a Stripe payment acceptance.

Decisions:
- Reuse Playwright config/auth/Prisma patterns. No Stripe SDK, fake production gateway, speculative payment UI, package.json change or cloud/account operation.
- Success driver calls the existing authenticated admin manual-renew API with an idempotency requestId; this proves only the existing recovery path. It does not implement automatic card charging, invoice verification, paid tier apply or Stripe calendar service periods.
- Keep fixtures local and disposable; preserve seed data and unrelated dirty files. Run failure probes against real use cases and report failures honestly.
- Ponytail full applies from the current repo skill. Existing R01 must be evaluated, not hidden by mocked success or relaxed assertions.

Open questions: B01–B10 remain unresolved where indicated in the billing plan; no new business policy is selected by simulation.
Artifacts:
- `e2e/plan-term-billing-readiness.spec.ts`: 8 real local API/browser tests with a simulated manual-renew payment-outcome driver.
- `docs/evidence/stripe-readiness-2026-09-11/recovery.pg.spec.ts`: 4 production-use-case/PostgreSQL probes with controlled failure/interleaving.
- `docs/evidence/stripe-readiness-2026-09-11/README.md`, `results-summary.json`, `recovery-output.txt`, before/after screenshots: exact commands/results/limits, source hashes and blocker register.
- P26, Stripe plan §8, `e2e/RESULTS.md` and sibling website billing spec updated to the executed results; Stripe T01–T42 remain NOT RUN.

Verification:
- Started fresh Playwright-managed app servers on web 3020/API 3021; build succeeded. PostgreSQL was local Docker port 15432, Redis 6379. Existing app servers on 3000/3001 were not stopped or reconfigured.
- Final browser run 2026-09-11T02:56:48.966Z: 6 passed / 2 failed / 0 skipped, exit 1, 28.8 seconds. BR01 proved a real browser branch creation after manual-renew simulation and unchanged quota/roles/old data/other-company term. BR02 sequential replay/activation, BR03 three holds and BR04 owner permission passed.
- BR05/R02 confirmed real API 403 for the term-disabled OWNER recovery notice. BR06/R06 confirmed a multi-company OWNER receives the wrong recovery copy because the page omits the selected company from fetchPlanTermNotice. Screenshot was stabilized by waiting for loaded recovery content; added BR06 after reviewing the first screenshot rather than accepting a loading frame.
- PostgreSQL probes: 1 passed / 3 failed / 0 skipped, exit 1. PG00 baseline passed; R01 stayed DISABLED after activation exception + replay, R05 concurrent same-request renewCount/audit became 2, R03 stale expiry sweep disabled a company whose renewal had committed. Captured actual runner output; failures are desired-behavior assertions, not expected-failure passes.
- Both test suites cleaned their disposable companies and audits; queried remaining e2e-billing-* company/audit counts = 0. Generated next-env.d.ts import restored to its observed original line only. No package.json edits or runtime fixes.
- Source/HEAD hashes and sanitized Playwright summary recorded; raw auth-bearing traces remain under ignored test-results and were not promoted to docs. Final before/after screenshots visually reviewed.
- Final document/evidence checks passed: browser/probe result counts, 7 source/test SHA-256 hashes, 51 local links across 5 scoped Markdown files, fences/whitespace and promoted-evidence credential-pattern scan. B01–B10 and T01–T42 remain complete with the matrix-wide NOT RUN status. `git diff --check` passed in both repos; package.json, generated next-env.d.ts and website index.html diffs are empty.
- Not run: actual Stripe/card/webhook/invoice/paid-tier/service-period/3DS/Test Clock integration, LINE/mobile/marketing E2E, UAT/LIVE. No Stripe/cloud/AI/LINE/email operation, charge, commit or push.

Next:
- Before reusing the existing flow: fix R01/R05 atomic completion/idempotency, R03 lifecycle/deadline fence, R02 scoped recovery access and R06 selected-company notice; keep all negative permission/hold checks. R04 marketing gap also remains.
- Rerun both suites to green, then implement policy-approved S0–S5 and replace the test driver with actual Stripe integration for T01–T42. A green manual-renew simulation alone never means Stripe E2E passes.
