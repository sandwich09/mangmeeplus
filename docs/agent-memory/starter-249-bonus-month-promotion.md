# Agent Memory: starter 249 bonus month promotion

Status: Release 1 IMPLEMENTED on branch `claude/starter-249-promotion-20261009` (2026-10-09) from the revised spec; no campaign exists, so the capability is inert. Plan: `docs/plans/starter-249-bonus-month-promotion-plan.md` (decisions R1–R19, acceptance map §8, open items §9).
Owner: Thawatchai / Codex
Scope: Admin console creates and manages campaigns; first campaign is STARTER_249 monthly buy one month get one month and annual purchase gets 13 months; bugs, gaps, impact, dependencies and change points.

Decisions:
- User requested specification only and no code changes. Follow-up on 2026-10-05 selected Admin console campaign creation as the main direction, replacing the earlier optional console proposal.
- User confirmed both new and existing companies are eligible, once per company per campaign. Monthly and annual share that limit; changing user or campaign revision must not reset it.
- User confirmed Q1: the free month includes 30 additional receipt units, totaling 60 for monthly and 390 for annual purchases.
- Monthly price is 249 baht. Source catalog annual default is 2,490 baht (ten monthly prices), not 249 × 12. Live policy overrides were not inspected.
- Admin navigation is Campaign promotions under Billing, with proposed list/create/detail routes at `/system/billing/campaigns`. Create a persistent draft, preview, publish/schedule, pause/resume/end and inspect usage/history; keep general Billing settings separate.
- Reuse Billing configuration draft/publication/permission/audit behind the campaign UI and add a redemption ledger. Campaign rules are data with a stable ID; Starter 249 is the initial template, not a name/price-based runtime condition. Sales event discounts, sales deals and admin free days retain their existing meanings.
- Saving an incomplete draft must not activate it. Publishing validates complete terms and exact revision; edits preserve accepted purchases and campaign usage. An ended campaign remains historical; a new campaign requires explicit creation/publication.
- Preserve paid service and bonus service separately. Provider renewal, receipt grants, AI cycle funding and proration must all understand the bonus period.
- No application code, package.json, schema, live configuration, cloud/provider state, deployment, commit or push changed.
- Initial follow-up requested E2E simulation; the 2026-10-05 report retained its 9 unresolved findings without silently approving business choices.
- On 2026-10-09 user requested closing all 9 spec gaps and rerunning simulation, still without code edits. User explicitly confirmed: bonus receipts immediately available with fixed expiry/no bonus carryover; earliest expiry then bonus before base on ties; normal Starter CHAT cycle in free month; no stacking; defer upgrades that overlap promo rights; no campaign reuse after paid refund; partial refund retains entitlements; full refund revokes only unused entitlements of its source; dispute uses existing Billing holds.
- Receipt specification integrates that expiry/tie rule within the existing package allocation group, adding PROMOTION as a package kind; existing team/purchased add-on group ordering and file eligibility remain explicit in §5.
- F01–F09 now have concrete contracts: pinned catalog signature; logical-environment uniqueness independent of provider; reservation commit cutoff with first-dispatch deadline and terminal-unpaid release; receipt/AI segment rules; distinct renewal readiness; explicit benefit choice and normal fallback; upgrade/refund action matrix; shared final policy fence and current cap counts.
- Added source-specific refund fencing/projection including in-flight OCR/AI, future invoice preservation and verified refund arriving before paid webhook. Never infer refund equals unused/no payment or restore campaign eligibility.
- Accepted snapshot is immutable after reservation even if campaign ends/catalog changes. Quote version checks apply before reservation; async recovery follows the original command/source.

Open questions:
- No remaining product-policy question among F01–F09 for the specified first release. Actual campaign start/end/cap are Admin inputs at creation time, not unresolved spec rules.
- Implementation evidence remains outstanding: current source rebase, PostgreSQL lock/uniqueness tests, payment/provider readiness, all receipt/AI/access/refund consumers, migration/rolling deployment and Web/LINE UI.

Artifacts:
- [Resimulation report 2026-10-09](../qa/starter-249-promotion-spec-e2e-resimulation-2026-10-09-th.md): closure matrix F01–F09, 82 results, 9 negative controls, source limitations and all 36 acceptance items.
- New evidence: `docs/evidence/starter-249-promotion-spec-e2e-2026-10-09/` contains `model-results.json`, `negative-controls.json`, `source-probe-results.json`, `acceptance-coverage.json` and durable diagnostic source/commands in `replay.md`. No diagnostic executable was added to app/test paths.
- Audited revised spec SHA256: `ee094b6b94f6074ab47f042bf61c9c0e7b4260e70f1cbedb56e321b8158f4372`.
- [Spec](../specs/starter-249-bonus-month-promotion-spec-th.md): updated 2026-10-09; Admin campaign direction, lifecycle, approved quota/AI/financial rules, contracts/fences, dependency map, G01–G18 source risks and A01–A36 acceptance. §12 maps each F finding to its closure.
- [E2E spec simulation report](../qa/starter-249-promotion-spec-e2e-simulation-2026-10-05-th.md): detailed journeys, 9 F findings, A01–A27 coverage and evidence limits.
- Evidence directory: `docs/evidence/starter-249-promotion-spec-e2e-2026-10-05/` (`model-results.json`, `source-probe-results.json`, `acceptance-coverage.json`). Audited spec hash before appending results: `fb859fecc07485e79903ffaa51466e17e87ce6f03ac99edcd4c1c0773031e97b`.
- Historical temporary diagnostic scripts and input spec snapshot (files had been cleared when revisited on 2026-10-09): `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/starter-promo-e2e-20261005-kjtvssyr/`; exact commands are in the report, hashes in JSON. No diagnostic source was added to application or repository test code.
- Working HEAD: `4a5817b4238379c2e3e3a24df996dd7168411eda`; branch `codex/sales-deal-card-auto-conversion-20260922`; extensive unrelated changes left intact.
- Primary audit source M: local `origin/main` snapshot `fddfd05baf97be683796f6b7db4d2e72157197db`, dated 2026-10-05. No remote fetch and no assertion that this is the deployed revision.
- Read-only extracted source: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/starter-promo-spec-20261005-uoqcpikq`; durable source references in the spec use Git revision and paths, not this temporary directory.

Verification:
- PASS 14 existing package/free-days tests with `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/billing/domain/billing-package.spec.ts src/modules/billing/application/billing-free-days.spec.ts` (exit 0).
- Compared package/free-days implementation between HEAD and M: no diff. Existing regression is not certification of M's entire dependency graph.
- PASS 8 source/calendar assertions via actual package helper: monthly/annual baseline 1/12 months + 30/360 receipts; candidate 2/13 calendar months; Jan 31→Mar 31; leap-year Feb 29→Mar 29 next year.
- Read official Stripe subscription-schedules and trials documentation. No native provider test or financial/customer mutation.
- Document validation checked 9 local links, 104 source path references, G01–G18 and A01–A22, and the updated Owner receipt decision. Initial checker also mistook two full test commands for file paths; corrected the checker to exclude command spans. Removed two Markdown hard-break trailing spaces before the final whitespace check.
- PASS Admin-console follow-up: 9 local links, G01–G18/A01–A27, preserved 60/390 quotas and one-company/one-campaign rule, removal of obsolete optional-console wording, and whitespace checks for both documents. Application tests above are prior audit evidence and were not rerun for this prose edit.
- NOT RUN: new promotion DB, concurrency, provider, browser/LINE, OCR/AI grant or deployment tests because no implementation was requested.
- PASS simulation: `python3 .../starter-promo-e2e-20261005-kjtvssyr/simulate.py .../model-results.json` returned 37 MODEL_PASS, 0 MODEL_FAIL, 7 conditional cases and 6 logical witnesses. These are reference-model assertions, not implementation acceptance.
- PASS reproduction: `node .../starter-promo-e2e-20261005-kjtvssyr/source-probe.cjs .../source-probe-results.json` returned 6 assertions. Exact M `aiCreditCycleAt` retains the old cycle key for trailing gift time and returns null for an intermediate free gap once a future paid period is present; no DB/provider/funding calls.
- Coverage of all 27 acceptance IDs: 11 MODEL_ONLY, 7 SPEC_GAP, 5 POLICY_PENDING, 4 NOT_RUN. None is certified as passed implementation E2E.
- PASS final evidence/document audit: 3 Markdown documents, 3 JSON evidence files, 15 local links, source/script/spec hashes, S01–S37, G01–G18, F01–F09 and A01–A27 consistency, plus whitespace checks. No application test suite rerun was needed for the report-only edits.

- PASS 2026-10-09: offline reference model returned 82 MODEL_PASS / 0 MODEL_FAIL (37 baseline + 45 closure cases); tested 6 serialized cap reduction orders within R35. These are independent in-memory state assertions, not DB concurrency proof.
- PASS 2026-10-09: nine deliberately defective temporary model variants were all detected by their expected regression case; no source files mutated.
- PASS 2026-10-09: exact M source probe reproduced 6 assertions including old intermediate AI free-gap null; this confirms the implementation still requires work and does not certify the new behavior.
- A01–A36 simulation coverage: 32 MODEL_PARTIAL, 4 NOT_EXECUTED (A12/A20/A21/A27). No acceptance item is represented as native implementation complete.

- PASS final 2026-10-09 document audit: 8 task files, 21 local links, A01–A36/G01–G18/F01–F09, JSON/result/spec/harness hash consistency and whitespace. Extracted the durable replay.md commands and successfully reran all 82 cases, 9 negative controls and 6 probes. Application diff hash across apps/packages/e2e/infra stayed identical to turn start.

Implementation 2026-10-09 (controller + lanes):
- Owner asked for review + implementation with the work split across model lanes by complexity, then admin-merge to main and develop. Five read-only source reviews came first; their findings changed the literal design (plan §1): campaign terms in `BillingPolicyRevision.promotionJson` beside the policy; `BillingInvoice.benefitEnd` and one `invoiceServiceEnd` helper for every reader that equated `periodEnd` with `paidThrough`; the pre-dispatch barrier compares the base policy hash; the fence only where `taken` can rise; pause/end as one-step closing commands; bonus-first tie in the allocator.
- One additive migration `20261009120000_billing_promotion_campaigns` (redemption table with CHECKs, two nullable columns, `PROMOTION` in the lot-kind CHECK).
- Release-1 matrix: INITIAL / RESTART in all four modes; REPEAT on an active one-time Starter of the same interval in the one-time modes. Refused with a reason (NORMAL stays purchasable): repeat on a live card subscription, scheduled change, upgrade, deal.
- Three independent reviews of the integrated diff found no P1 in the API and one in the web (a ticket-only shop sent the new quote field); fixes are R15–R19.
- Test wiring: new unit spec in `scripts/line-ai-whole-chain-acceptance.catalog.mjs`; four `billing-promotion*.pg.spec.ts` in the PostgreSQL step of `.github/workflows/ci.yml`. GitHub Actions was in `startup_failure`, so the gate ran locally (mirror of the PR jobs, PostgreSQL step against a throwaway database).

Open:
- Native Stripe test-mode proof and browser acceptance on UAT before any campaign is opened to real customers.
- Refused combinations and staff-handled refund cases listed in plan §9.
- Rollout: after the first promotion purchase never roll back past this release (an older binary fails closed on a `PROMOTION` lot).

Next:
- UAT deploy by the mandatory protocol (`docs/runbooks/uat-production-v2-deployment.md`), then on UAT: create a TEST campaign from the Starter template, buy with a test card in CARD_ONCE and CARD_AUTO, and check the bound subscription's trial end.
- Production promotion only on the Owner's explicit go.
