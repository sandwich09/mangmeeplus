# Agent Memory: billing single administrator

Status: implemented locally; focused verification complete; preparing one source CI. Not deployed yet.
Owner: Codex, under explicit owner instruction 2026-09-16.
Scope: both environments in code; UAT deployment only. No role elevation or live charge.
Decisions: genuine active SYSTEM_ADMIN plus exact action and approval permissions may self-confirm; preserve password, preview, explicit confirmation, idempotency, audit and worker authority checks. Scoped delegates still need another reviewer. No synthetic actor, migration or new config.
Open questions: no product-policy question pending. Owner has signed into native Chrome as real platform Admin. Current-password reauthentication will be needed immediately before policy publication after deployment; never request it in chat.
Artifacts: docs/specs/billing-single-admin-spec-2026-09-16.md; docs/plans/billing-single-admin-plan-2026-09-16.md; docs/evidence/billing-single-admin-2026-09-16.json. Worktree mangmeeplus-uat-release, branch codex/billing-single-admin-20260916, base main ffa4fc91. Original checkout preserved.
Verification:
- Contracts/API builds and API/web typechecks passed. Final production-code API typecheck46001 exit0. Shared approval units2/2; executable catalog4/4. No package.json changes.
- Scheduled real Nest/PostgreSQL HTTP11groups passed; final scheduled Chromium12groups passed65.85s. Final refunds Chromium16groups passed194.8s, including native-page self-confirmation and loss of SYSTEM_ADMIN while retaining delegate capabilities blocking a new provider write.
- Broad configuration Chromium R4 reached and completed configuration/scope/package/free-day/collection/receipt/manual-receipt groups, then failed at the refund fixture's missing simulated Stripe customer GET. Added the exact fixture customer/email/account metadata; focused refund replay passed. R4 is retained as a failed suite, not an overall browser PASS. Final full configuration HTTP result is recorded in the linked evidence.
- Additional full CONFIG_ONLY HTTP replay reached the refund phase but exceeded the operator600s limit without a reported assertion failure. Record as incomplete, preserve log; do not claim full suite PASS or start duplicate CI. Required CI remains the merge gate.
- Earlier local fixture failures retained: stale other-actor scope/free-day replay assertions after self-confirmation; duplicate collection test restoring a role too early; manual receipt fixture still using old UI labels. Fixed fixtures without weakening application guards. Different actor replay still409.
- Review removed an accidental financial-read dependency from scope administration: role management is rechecked after actor locks. R4 exercises self-confirmation with financial-read removed. Additional final HTTP uses the same source but exceeded the operator600s limit; no overall pass is claimed.
- Mobile captures inspected: configuration, package, scopes, receipts, free days, refunds and scheduled policy. Short Thai copy explains confirmation and history shows the actual approval mode. No horizontal overflow in browser checks.
- Local production-image security suite passed26tests, maintenance pins48files passed. No controller/security files changed.
- Isolated PostgreSQL18.3 container mangmee-single-admin-pg-20260916/15441 with219migrations; Redis mangmee-single-admin-redis-20260916/16389. Clean only these owned disposable containers after verification.
- Private evidence .env.kamal/uat/single-admin-20260916 retains logs, failed attempts, screenshots and generated Next guidance. Generated Next files excluded from source.
Native state:
- UAT still serves ee2f5542, accepted operation20260916T080218Z-b9eb3d90, signed/customerOPEN. No new release for this amendment.
- Real Admin Chrome tab325831760 can access platform Billing Admin. Saved native draft8b376fa9-4553-475a-af71-732cb53db90b/version0 with all12Sandbox prices, Portal, VAToff,7days and approved gates. Settingsversion0/unpublished; no Checkout/payment. Reuse this draft after deploy, do not create a duplicate or preview before CI finishes.
- User/browser password proof remains required; do not bypass through direct DB/API credentials. Native paid E2E still outstanding; real Postmark delivery already recorded in prior release evidence.
Next: one PR/source CI; authorized admin merge after success and synchronize develop/main without duplicate paid validation when supported; reread deploy protocol and run one UAT hotfix with signed/customerOPEN acceptance; publish native draft with genuine reauthentication, then Sandbox purchase/rights/history. No Production deploy.
