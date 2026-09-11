# Package entitlements — scoped evidence 2026-09-11

Status: **DOC/SOURCE/CURRENT REGRESSION PASS; full PE01–PE36 paid E2E NOT RUN; Stripe runtime NOT IMPLEMENTED**. [Spec](../../specs/mangmee-package-entitlements-spec-th.md), [plan](../../plans/mangmee-package-entitlements-plan-th.md), [marketing mirror](../../../../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md).

| Check | Observed | Boundary |
|---|---|---|
| Source/catalog contract | 3/3 PASS, included in focused292 | Exact poster prices/limits and cross-repo mirror; actual starter17keys/7menus/6parents; trial15. No annual runtime/Checkout proved |
| Existing use-case/contract regressions | 289/289 PASS, combined **292/292**, 0 skipped/fail | Real onboarding/provisioning composition over in-memory doubles, plan terms, receipt allowance/apply and feature contracts. Not browser/real PostgreSQL/native LINE/Stripe |
| Existing specialist/WHT guard and handoff | **38/38 PASS**, 0 skipped/fail | CLOSED/missing initial issue no SYSTEM certificate; existing external handoff idempotency/tenant safety; specialist matrix invariants. OPEN-path unit fixture is not a live gate change |
| Real current marketing bundle in Chromium | **2/2 PASS**, 1440px/390px | Current monthly catalog5, all4 paid buttons disabled, trial keyboard/modal, no client errors/horizontal overflow, **0 external POSTs**. No annual toggle or signup provisioning/Stripe asserted |
| Docs | Run [verify-docs.py](verify-docs.py); [result](doc-check.json) | Local link existence, canonical catalog equality, PE01–PE36 IDs and status boundaries. Not remote-link, anchor, runtime or completeness proof |

Focused total **330 = 3 source/doc + 327 application/contract tests**, separate from 2 browser scenarios. Logs: [focused TAP](focused.tap), [tax lock TAP](tax-lock.tap), [marketing log](marketing.log), [browser JSON](marketing/results.json). There were no failed or skipped test runs in these commands. All use-case stores are test doubles; no customer DB or provider mutations performed and no new service-restart/config-propagation proof claimed. Marketing fixture serves only sibling bundle on a random loopback port and closes browser/server itself.

Reproduce the exact current checks from mangmeeplus root with [verify-current.sh](verify-current.sh). It uses existing tsx/Playwright dependencies, no install/build/deploy. Then run `python3 docs/evidence/package-entitlements-2026-09-11/verify-docs.py`. Source snapshot contains selected touched/source hashes and both repo HEADs with dirty-tree caveat; it is not an attestation of the entire dependency tree. Never rerun old evidence checkers into historical directories to replace earlier hashes.

Current screenshots: [pricing desktop](marketing/pricing-1440.png), [pricing mobile](marketing/pricing-390.png), [trial desktop](marketing/trial-1440.png), [trial mobile](marketing/trial-390.png). These show the existing pre-LIVE bundle, not a mockup of new annual UI.

Read-only impact audit: signup already uses modulePackage starter, unlike stale P26 description; corrected docs. Six parents yield seven menu entries because dashboard/notifications share a key. WHT issuance has existing `cap.wht50bis` guards; preserved external handoff/payment facts in target lock design. PND53 review reports/exports are not official filing support. Monthly/yearly entitlement apply, Enterprise lock across newly implemented billing/API/Portal/old sessions and all PE scenarios still need PE-S1–S5 implementation and actual acceptance evidence. Real Stripe/native LINE acceptance remains separate.
