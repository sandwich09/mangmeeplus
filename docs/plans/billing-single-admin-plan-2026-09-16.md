# Billing single administrator implementation plan

Status: IMPLEMENTED, merged to develop/main, deployed to UAT. Native Sandbox publication and published configuration checks passed; native purchase awaits a company owner session. Source: [approved spec](../specs/billing-single-admin-spec-2026-09-16.md).

1. Add one shared permission predicate using existing platformScope and exact action plus approval capabilities; use it in reads, command transactions and deferred execution.
2. Update configuration/schedules, company scope grants, receipts, plan/free-day/collection changes and refunds. Derive confirmation mode from retained real actor IDs and include it in DTO/audit evidence without schema changes.
3. Replace two-person-only Thai instructions with accurate confirmation/recovery/history copy. Keep separate review, password proof and explicit final confirmation.
4. Extend existing focused real HTTP/PostgreSQL/browser smoke fixtures for single-admin success and delegated self-denial; retain independent-approval regressions, stale/replay/permission/credential controls and worker tests. Build/typecheck and inspect mobile UI.
5. Batch source changes for CI once locally ready; reuse exact-commit successful validation for both target branches where the repository supports it. Merge develop/main only after CI succeeds. Read the mandatory deployment protocol before one UAT hotfix and verify signed result/customer OPEN. No Production deploy.
6. Continue native UAT Sandbox activation and paid E2E through the authorized Admin session when available; record any exact credential/session blocker separately from product-policy decisions.

Verification/results:

- Contracts/API builds, API/web typechecks, shared approval 2/2, catalog 4/4, local image security 26 tests and maintenance pins for 48 files passed. Final real PostgreSQL/HTTP/Chromium refunds passed 16 groups and scheduled policy passed 12 groups.
- Broad local configuration browser R4 failed at a missing provider customer fixture after the preceding changed service groups completed. The fixture was corrected and focused refunds passed. An additional broad HTTP replay exceeded the operator 600-second limit. Both earlier attempts remain failed/incomplete evidence.
- Full source CI 35080266183 subsequently passed, including 257 billing HTTP groups and all configured browser suites, before PR 595 merged. Develop/main synchronized at `7ccff811` with the exact tested tree; only one full source CI was dispatched.
- UAT hotfix `20260916T103914Z-350853d8` passed all 11 phases, signature and customer OPEN in 443.532 seconds. The 219-migration catalog matched; no new or pending migrations.
- Native Admin Stripe preview `69214c53-9bab-48ed-99fe-c2767421a777` passed. The owner confirmed the current password, then native submit/self-confirmation published settings version 1, request version 2. Published configuration check `0fd91395-5017-475a-ae05-c37315db87b4` passed at 10:55:10 UTC for policy, account, six paid/six prepaid-zero prices, Portal and tax.
- The current Admin is not a member of the original customer test company. Genuine company-owner login is pending for native purchase. No native payment or Production acceptance is claimed.

See [release report](../evidence/billing-single-admin-uat-release-2026-09-16.md), [verification evidence](../evidence/billing-single-admin-2026-09-16.json) and [task memory](../agent-memory/billing-single-admin-2026-09-16.md).
