# Agent Memory: Stripe access repair and proof loop

Status: COMPLETE for S-pre and pre-LIVE marketing; Stripe provider integration remains NOT IMPLEMENTED / NOT RUN.
Owner: thawatchai + Codex
Scope: User requested spec, plan and executable proof through the completed local repair loop. Fixed existing manual term/access defects and pricing alignment in both repositories; no new billing policies, Stripe account operation, charge or deployment.
Decisions:
- Shared Company row lock for set/renew/lifecycle/sweep; term/lifecycle/audit atomic. Dedupe inside transaction with normalized-days comparison; admin hold marker supersedes automatic expiry.
- Reuse existing NotificationEvent/Recipient/Delivery as the durable queue in the same transaction, with transaction-bound repositories and per-event advisory lock. No new outbox consumer/dependency/schema.
- Authenticated selected-company recovery includes password login and legal acceptance, never public access or business permission bypass. Strict notice JSON/error states and company-keyed UI.
- Marketing keeps the existing trial request modal, separates FREE_TRIAL 30d/1/2/15, disables paid buttons natively, aligns metadata/noscript/FAQ. No external lead submitted; paid handoff remains future Stripe work.
- Preserve original red evidence and unrelated expense edits. Tests use local isolated ports and disposable fixtures; no package.json edits, commit/push/deploy.
Open questions: B01–B10 and Stripe account/SDK/API version configuration are not decisions made by this repair. Checkout/webhook/invoice service-period application, provider E2E and LIVE acceptance remain S0–S5, RG06/T01–T42.
Artifacts:
- [Executed repair report](../evidence/stripe-repair-2026-09-11/README.md), results-summary.json, source-sha256.json, screenshots/logs and read-only legacy inspection SQL.
- P26/P29 specs/plans, Stripe developer reference and sibling mangmee_web spec/README updated to final runtime/proof status.
- e2e/plan-term-billing-readiness.spec.ts (20 cases), e2e/stripe-marketing-readiness.mjs, real-PG recovery.pg.spec.ts (15 cases).
Verification:
- Final browser run 2026-09-11T04:16:04.681Z: 20 PASS, 0 failed/skipped/flaky; real BFF/API/DB, simulated ADMIN manual-renew outcome, real branch UI mutation.
- Real PostgreSQL: 15 PASS (concurrency, rollback/replay, stale selection, holds, partial durable notification and read-only legacy report).
- Focused use-case/auth/legal/permission/notification suites: 198 PASS.
- Actual marketing Chromium at 1440px/390px: PASS; native disabled controls, catalog, keyboard request modal, no overflow/client errors/external POST. Final screenshots visually checked.
- Production-source API/web TypeScript: PASS. Full API TypeScript reports 2 pre-existing unrelated Buffer errors at substitute-receipt-download.use-case.spec.ts:376,381; recorded, not modified.
- Cleanup: e2e-billing company/user/notification/audit counts 0. 44 append-only legal action records deliberately retained; no legal-evidence deletion/trigger bypass. Generated next-env route path restored.
- git diff --check passed both repos; package.json unchanged. Original red artifacts remain unchanged.
Next: No work remains in S-pre/R04 pre-LIVE proof loop. Implement Stripe S0–S5 only with the relevant B01–B10/config decisions; do not equate manual-renew simulation with provider payment acceptance.
