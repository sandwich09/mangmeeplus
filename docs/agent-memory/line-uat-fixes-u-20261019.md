# Agent Memory: LINE UAT fixes U 2026-10-19

Status: Complete for local code and verification, within the 60-minute cap (started 06:00 UTC). Scoped diff left uncommitted.
Owner: Codex
Scope: Owner's U1–U6 acceptance on Starter, against develop 360908871545432de575fed87ac4d6272eeb2e39; no deploy/commit.

Product goal: A LINE customer receives a truthful short answer and a permitted way forward: credit refusal instead of slowness, entitlement-aware document help, current capabilities, package lifecycle facts, clean package names and active prices.
Architecture: Reuse the current metered intake, semantic turn, action registry, web billing catalog and guarded ERP actions. Gateway receives public offer facts from API; no database access, tenant/permission relaxation, new feature flag or final-mutation change.
Decisions:
- U1: One trusted budget-response parser feeds the existing 429/customer card/status mapping. Covers intake, turn and OCR; image intake refunds unused receipt admission and preserves the refusal. Permanent general-answer refusals close the ledger as refused, preventing a futile reclaim.
- U1b: The serving-runtime capability probe occurs before grant issue; provider reservation occurs later, immediately before an admitted model call. A failed startup probe creates no customer hold/debit and has nothing to release. Granted runtime-unavailable responses without a model call also reserve/debit nothing. Existing funded failed-call settlement cancels the customer hold, excludes customer aggregates/CONSUME and preserves company cost as COMPANY_ABSORBED. No historical customer ledger was accessed or repaired.
- U2: Shared document definitions and product action/limit facts replace unsolicited model offers. Manual 50 ทวิ recording requires current expense entitlement, source-read access and wht.external_certificate.link; issuing requires wht_50bis and action permissions. ภ.ง.ด.3/53 share wht_pnd53; vouchers retain expense action guards. Short confirmations inherit only the immediately preceding document topic and recheck current access.
- U3: Extend the existing capability recognizer (Thai/English/short forms); derive current actions with canUseLineChatAction, recheck them in the API and label bounded native buttons with the actual job. There is still a metered intake, not a new model-free LINE route.
- U4: Lifecycle answers distinguish exhausted receipt reads from ended access. An active shop can use authorized manual entry or a full-package purchase; after term/applicable grace ends the shop is paused, records remain and the owner can renew.
- U5: customerPackageName reuses the web Thai tier names and supplied price; English uses customer names. Visible-field wording is shared by legacy and frozen delivery, preserving URIs/signed control data and external vendor names. Remove plan enums and em dashes; missing-value cells remain nonempty.
- U6: BillingService.catalog() is the web ACTIVE-policy read path (offerTerms), reused for capacity and passed through API -> gateway -> AgentCore for offers. Missing active price facts never fall back to catalog prices: name the tier and ask to check current prices. Purchase cards/choices use the same customer helper and current catalog/quote.
- Additive non-budget LINE fields: packageOffers and chatActionIds. AiBudget* shapes, profile-table digest, estimator contract, AI_FINAL_MUTATION_ENABLED and tool-policy gates are unchanged. Peer provider-usage-estimate.ts/spec and every package.json are untouched.

Source facts:
- docs/specs/mangmee-billing-pack-amendment-2026-09-12.md (renewal grace/access, retained balances and full-package purchase).
- docs/specs/mangmee-billing-subscription-spec-th.md § receipt exhaustion; docs/specs/mangmee-package-entitlements-spec-th.md § paid-period grants.
- apps/web/src/features/billing/BillingPage.tsx (grace preserves remaining reads without replenishment); BillingService.catalog(); expense-payment-preparation-voucher-spec-th.md (manual 50 ทวิ versus system issuance).

Artifacts:
- /private/tmp/line-uat-u-last-message.md: final report, at most 40 lines.
- /private/tmp/line-uat-u-changed-files.txt; line-uat-u-api-importers.json (all 511 registered API specs run, including 19 direct importers).
- /private/tmp/line-uat-u-*-complete-full.log; line-uat-u-chain-*.log; line-uat-u-required-gates.log; line-uat-u-baseline-comparison.json.
- W00 regenerated in docs/research/mangmee-ai-capability-manifest-2026-09-27.json.

Verification:
- Contracts build passed; final contracts full: 487 passed. Gateway full: 2,445 passed, 46 listener-dependent tests cancelled exactly as on the starting commit.
- Required real-module DI, table delivery-plan and W00 checks: 43 passed; W00 itself 5 passed. Whole-chain catalog/harness: 9 passed.
- Final whole-chain: reliability API 472, web 8, contracts/evaluation 232, API behavior 2,415, gateway behavior 1,305 passed; all four infra shell suites passed. Reliability gateway: 589 passed, 12 socket failures and 46 cancellations, matching baseline.
- Final API full: 12,041 passed, 2 pre-existing listener EPERM failures, 199 standard database/environment skips (all 511 registered specs, including every direct importer). Both API and gateway typechecks passed; contracts build and git diff --check passed.
- No-charge settlement unit suite: 67 passed, including released customer hold, zero CONSUME and preserved company cost on failed funded calls. Registered customer wording/button checks: 95 passed. Baseline comparisons are identical for every remaining failure/cancellation; no new regression remains.

Open questions: No unresolved implementation boundary. Sandbox cannot run native LINE/browser visual acceptance at 390/1280, real provider calls, PostgreSQL/Docker integration, or reconcile the seven reported historical turns; those results are not claimed.
Next: Review the uncommitted diff and /private/tmp/line-uat-u-last-message.md; native LINE/browser and database/provider acceptance require an environment that supports them. No further local implementation work remains.
