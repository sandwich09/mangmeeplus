# Plan: Starter 249 bonus-month promotion — release 1

Status: IN PROGRESS (2026-10-09). Spec: [starter-249-bonus-month-promotion-spec-th.md](../specs/starter-249-bonus-month-promotion-spec-th.md). Memory: [agent-memory](../agent-memory/starter-249-bonus-month-promotion.md).

Base: `origin/main` `7d2f21fae` (tree identical to `origin/develop`). The billing module is byte-identical to the spec's base "M" except `schema.prisma` (+32 lines) and one migration.

This plan is the binding contract for every implementation lane. Where it differs from the spec's literal wording, §1 says why; the spec's product rules (§2, Q1–Q6) are unchanged.

## 1. Review findings that change the literal design

Five read-only source reviews ran before this plan. These findings are decisions, not options.

| ID | Finding (verified in source) | Decision |
| --- | --- | --- |
| R1 | A new key inside `policyJson` makes an older API binary fail `parseBillingPolicy` and close **all** sales (`billing-policy.ts:30`, `billing.service.ts:166`). The general settings page also round-trips the whole policy and `saveDraft` parses strictly, so incomplete campaign drafts are impossible there. | Campaign terms live in a sibling nullable column `BillingPolicyRevision.promotionJson` (`Record<campaignId, campaign>`). `publish()` writes `proposed.promotions ?? <current revision's promotionJson>`, so a general publish can never drop or edit campaigns and a campaign publish carries the policy unchanged. Incomplete drafts are `BillingOperation` rows of type `PROMOTION_CAMPAIGN_DRAFT` (`type` is a String; no migration). |
| R2 | Eight readers assume `invoice.periodEnd == account.paidThrough` (`billing.service.ts:187, 634, 867`; `billing-purchase-source.ts:18`; `billing-end-package.ts:29`; reconciler `:602, :752, :971, :1058, :1069`). With `paidThrough = benefitEnd` and `periodEnd = paidEnd` a healthy promo shop becomes `SOURCE_INCONSISTENT` and can buy nothing. The spec names only end-package. | One nullable column `BillingInvoice.benefitEnd` (service end including the free time; null = `periodEnd`) and ONE helper `invoiceServiceEnd(invoice)`. Every equality above compares `invoiceServiceEnd(invoice)` to `paidThrough`. The financial period (`periodStart/periodEnd`) is never stretched. |
| R3 | The pre-dispatch barrier fails an attempt when the policy revision id or settings version changed after the reservation commit (`billing.service.ts:729-730`), and `resume()` hides the URL (`:1111`). Every pause/end publishes a new revision, so a RESERVED right would be withdrawn — against spec §6 / A04 / A30. | For an attempt whose snapshot holds a promotion, the barrier and `resume()` treat the revision as unchanged when `configurationHash(currentRevision.policyJson) === configurationHash(attemptRevision.policyJson)`; gate checks stay. A base-policy change in that sub-second window still fails closed (release + re-quote), which is the conservative side of the spec. |
| R4 | "Every final mutation takes the fence" is over-specified: `taken` only rises in reserve/re-reserve. Release/consume sit inside ~10 Company-first transactions; retrofitting a fence-first order there is the deadlock risk. | The advisory fence `billing-promotion-policy:<env>` is taken — always as the FIRST lock — only by reserve/re-reserve and by admission-changing publications (publish, pause, end, resume). Consume and release stay row-guarded `updateMany` under the existing Company lock, exactly like the event ticket. Checkout pre-reads the quote without a lock to know whether to take the fence. |
| R5 | Pause/end through preview → submit → approve needs Stripe network calls and a 10-minute window; it is not "immediate". | Pause and End are one-step closing commands modelled on `close()` (emergency close): one transaction, reauth, `expectedVersion`, idempotency key, reason, new revision, audit. Anything that opens admission (first publish, edit, cap change, resume) goes through the existing preview → submit → approve workflow. `effectiveAt` scheduling is not used for campaigns: "scheduled" = published with a future `startsAt`. |
| R6 | Re-POSTing "the exact original payload" is unsafe: `expires_at` is not pinned; a same-key different-params POST returns 4xx → REJECTED → treated as proof of no sale → release (`billing.service.ts:802, 821`). | Recovery is read-back by customer + metadata only (as today). Never re-POST a Checkout for a reserved promotion. |
| R7 | The allocator's tie order is `expiresAt, createdAt, id`; base and bonus share `expiresAt`, and `id` is a random uuid, so the spec's own example yields 40 instead of 60. `availableAt = appliedAt` breaks the `sourceHash` replay check. | Comparator: group → `expiresAt` → PROMOTION first → (stable) `createdAt, id`. Bonus `availableAt` = verified `paidAt`, like the base lot. Bonus `sourceKey` = `promo:<invoiceId>`. |
| R8 | `receiptLots` throws on an unknown kind by design (fail closed). An older binary reading a `PROMOTION` row would fail OCR admission, status and paid apply. | Keep fail-closed. No `PROMOTION` row can exist before an Admin publishes a campaign and a shop buys it. Rollout note: after the first promotion purchase, never roll back to a release older than this one. |
| R9 | `aiCreditCycleAt` returns the stretched last paid cycle in a free tail and `null` in a free gap before a future paid period; `chainStart` would lose the original anchor across a clamped free month. | Promo segments come from non-revoked `PROMOTION` receipt lots (`serviceStart/serviceEnd` = `[paidEnd, benefitEnd)`). A segment yields exactly one cycle starting at `paidEnd`; the gift-day stretch targets whichever run ended last; `chainStart` treats segments as contiguous links; an overlap with a kept paid period returns `null` (stop funding). No new column. |
| R10 | `BillingRepeat` (repeat on a live CARD_AUTO subscription) needs ~10 edits in a journaled Stripe schedule state machine, has no registered spec, and a 13-month zero-price phase on a yearly price has never been exercised. Scheduled changes create pending operations matched on `periodEnd: paidThrough`. | Release-1 support matrix in §2. Unsupported combinations return `PROMOTION_UNAVAILABLE` with a reason and leave NORMAL purchasable (spec §7 allows closing a combination with an explicit reason). |
| R11 | `renewalSetupState` and `entitlementAdjustmentState` can be derived. | No state columns. `renewalSetupState`: NOT_REQUIRED (one-time) / PENDING (applied, slot held, no subscription) / REVIEW (journal older than 23 h or open issue) / READY (subscription bound) / CANCELLED. `entitlementAdjustmentState` from `refundedSatang`, `paidSatang` and `BillingPromotionRedemption.entitlementAdjustedAt`. |
| R12 | Every billing table is scoped by `(stripeAccountId, livemode)`. | `promotionEnvironmentId = livemode ? 'LIVE' : 'TEST'`. Provider account is a binding on the redemption row, not part of uniqueness. Carrying campaigns across a Stripe account change is out of scope (no account-migration tool exists). |
| R13 | `offer.intervalCount` is a trap: sales attribution turns it into months (`billing-package-request.ts:160`). | Never express bonus time through `intervalCount`. Boundaries come from `promotionBoundaries()` only. |
| R14 | `endPaidPackage` revokes only the four base kinds and is an optional flag; a full refund of an auto-renew source would still charge at `benefitEnd`. | Add `PROMOTION` to the revoke list; a cumulative-full refund of a promo source forces end-package; a partial promo refund rejects the flag; an auto-renew promo source must have renewal cancelled first (existing `BILLING_END_PACKAGE_AUTO_RENEW`). The redemption stays CONSUMED and is stamped `entitlementAdjustedAt`. |

## 2. Release-1 scope

**Supported promotion purchases**

| Purchase | Modes |
| --- | --- |
| INITIAL (new shop, legacy trial) and RESTART (expired paid) | CARD_ONCE, PROMPTPAY_ONCE, CARD_AUTO, PROMPTPAY_RENEW |
| REPEAT on an active one-time Starter of the same interval (continues from `paidThrough`) | CARD_ONCE, PROMPTPAY_ONCE |

**Refused with `PROMOTION_UNAVAILABLE` + reason `PURCHASE_KIND_UNSUPPORTED` (NORMAL stays purchasable)**: repeat on a live CARD_AUTO subscription; any scheduled change (cadence or tier) as the promo purchase; upgrade; sales deal / advance deal. Already refused today for every purchase: active PROMPTPAY_RENEW, a subscription still trialing, a pending plan change, holds.

**After a promotion purchase**: immediate upgrade (differential or full-package) overlapping paid, free or future promo time → `PROMOTION_UPGRADE_DEFERRED` with the date `max(benefitEnd, paidThrough)`; stop/resume renewal works while the bound subscription is trialing; grace and sweep read `termEndsAt = benefitEnd`; partial refund keeps everything; verified cumulative-full refund ends the source's unused entitlement; dispute keeps today's `FINANCIAL_REVIEW` hold.

**Deferred (documented, not built)**: repeat on a live CARD_AUTO subscription (needs Stripe test-mode proof of the 13-month zero-price phase); promo on scheduled changes; automatic entitlement adjustment for a full refund of a not-yet-started (future) promo source and for dispute won/lost (staff-handled, state shows PENDING/REVIEW); a sweep for attempts stranded in CREATING (`createBy` is stored; the existing forced-expiry tool releases); provider-account migration; marketing-site copy (separate repository); native Stripe test-mode proof and browser acceptance on UAT.

No feature flag or env switch: the capability is always on and inert until an Admin publishes a campaign.

## 3. Data model (one additive migration)

`apps/api/prisma/migrations/20261009120000_billing_promotion_campaigns/migration.sql` — additive only, TEXT + CHECK (repo convention), header comment.

- `BillingPolicyRevision.promotionJson JSONB NULL`
- `BillingInvoice.benefitEnd TIMESTAMP(3) NULL`
- `BillingReceiptGrant_valid_units_period_kind` CHECK: DROP + ADD with `'PROMOTION'` in the kind list and `AND ("kind" <> 'PROMOTION' OR ("units" > 0 AND "expiresAt" = "serviceEnd"))` (pattern of `20260929150000`).
- `BillingPromotionRedemption`:
  `id`, `promotionEnvironmentId` ('LIVE'|'TEST'), `campaignId`, `companyId`, `billingAccountId`, `stripeAccountId`, `livemode`, `state` (CHECK in RESERVED, CONSUMED, RELEASED), `policyRevisionId`, `campaignRevision` INT, `termsHash`, `offerKey`, `interval`, `offerSignature`, `bonusMonths` INT, `bonusReceiptUnits` INT, `attemptId` NULL UNIQUE, `invoiceId` NULL UNIQUE, `acceptedAt`, `createBy`, `consumedAt` NULL, `benefitAppliedAt` NULL, `releasedAt` NULL, `entitlementAdjustedAt` NULL, `paidStart` NULL, `paidEnd` NULL, `bonusEnd` NULL, `releaseCount` INT DEFAULT 0, `version` INT DEFAULT 0, `createdAt`, `updatedAt`;
  UNIQUE `(promotionEnvironmentId, campaignId, companyId)`; INDEX `(promotionEnvironmentId, campaignId, state)`; INDEX `(companyId)`.
  A release clears `attemptId` (the old id goes to the audit row) and increments `releaseCount`; a re-reserve reuses the row under a `version` guard.

## 4. Contracts (`packages/contracts/src/billing.ts`, additive)

Do not edit `ai-tools.ts`, `feature-entitlements.ts`, `line-ai.ts`, `menu-entitlements.ts` (hashed by the capability manifest).

```ts
export type BillingBenefitChoice = 'NORMAL' | 'PROMOTION' | 'EVENT_DISCOUNT';
export type BillingPromotionEnvironment = 'LIVE' | 'TEST';
export type BillingPromotionRule = { offerKey: PaidTier; interval: BillingInterval; bonusMonths: number; bonusReceiptUnits: number; offerSignature: string };
/** Published terms inside BillingPolicyRevision.promotionJson[campaignId]. */
export type BillingPromotionCampaign = { campaignId: string; type: 'BONUS_MONTHS'; revision: number;
  internalName: string; description: string | null; displayName: string; rules: BillingPromotionRule[];
  startsAt: string; endsAt: string; cap: number | null; paused: boolean; endedAt: string | null };
export type BillingPromotionCampaignStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'CATALOG_STALE';
export type BillingPromotionUnavailableReason = 'NOT_STARTED' | 'ENDED' | 'PAUSED' | 'CAP_FULL' | 'ALREADY_USED' | 'IN_PROGRESS'
  | 'CATALOG_STALE' | 'OFFER_NOT_COVERED' | 'PURCHASE_KIND_UNSUPPORTED' | 'CHANGED';
/** Pinned into BillingSnapshot.promotion at quote; the reservation and the apply read only this. */
export type BillingPromotionSnapshot = { environmentId: BillingPromotionEnvironment; campaignId: string; revision: number; termsHash: string;
  displayName: string; offerKey: PaidTier; interval: BillingInterval; offerSignature: string; bonusMonths: number; bonusReceiptUnits: number };
export type BillingQuotePromotion = { campaignId: string; displayName: string; bonusMonths: number; bonusReceiptUnits: number;
  totalReceiptUnits: number; paidStart: string; paidEnd: string; benefitEnd: string; expectedNextChargeAt: string | null };
/** Company-scoped view on BillingStatus.promotions: what the package page may advertise and why not. */
export type BillingPromotionOfferView = { campaignId: string; displayName: string; offerKey: PaidTier; interval: BillingInterval;
  bonusMonths: number; bonusReceiptUnits: number; totalMonths: number; totalReceiptUnits: number; endsAt: string;
  available: boolean; reason: BillingPromotionUnavailableReason | null };
export type BillingRenewalSetupState = 'NOT_REQUIRED' | 'PENDING' | 'READY' | 'REVIEW' | 'CANCELLED';
export type BillingPromotionUse = { campaignId: string; displayName: string; state: 'RESERVED' | 'CONSUMED'; paidEnd: string | null;
  benefitEnd: string | null; bonusMonths: number; bonusReceiptUnits: number; renewalSetupState: BillingRenewalSetupState; expectedNextChargeAt: string | null };
```

Additive fields: `BillingQuote.benefitChoice?`, `BillingQuote.promotion?: BillingQuotePromotion`; `BillingStatus.promotions?: BillingPromotionOfferView[]`, `BillingStatus.promotion?: BillingPromotionUse`, `BillingStatus.upgradeDeferredUntil?: string`; `BillingAttemptView.promotion?`; `BillingInvoiceItem.promotion?: { displayName; paidEnd; benefitEnd; bonusReceiptUnits }`; `BillingCatalog.promotions?` (announceable fields only: displayName, offerKey, interval, bonusMonths, bonusReceiptUnits, totals, endsAt — no company or usage data).

Admin types: `BillingPromotionCampaignDraft` (every campaign field optional + `campaignId`), `BillingPromotionCampaignView` (`campaignId`, `status`, `published`, `draft { operationId; version; values; validationErrors[] } | null`, `pendingOperationId | null`, `usage { reserved; consumed; taken; cap }`, `allowedActions[]`, `pendingCheckouts`), `BillingPromotionCampaignList` (`mode`, `settingsVersion`, `capabilities`, `campaigns[]`, `template`), `BillingPromotionPreviewRow` (per rule: price, tax totals, paid months, bonus months, total months, base/bonus/total receipts, example `paidEnd`/`benefitEnd`, renewal price, blockers), `BillingPromotionCampaignReport` (counts: reserved, paidAwaitingApply, applied, releasedBeforePay, refunded, fullyRefunded, rightsActive; bonusMonthsGranted; bonusReceiptUnitsGranted; `moneyReceivedSatang`/`refundedSatang` only with `system.billing.financial.read`; `companies[]` rows with links to the existing attempt/invoice pages).

Constants: `BILLING_PROMOTION_STARTER_TEMPLATE` (STARTER_249 month + year, `bonusMonths: 1`, `bonusReceiptUnits: 30`, required base receipts 30/360, required monthly price 24,900 satang).

Error codes (API `billingError`; Thai text in the web dictionary): `PROMOTION_UNAVAILABLE` (body also carries `reason`), `PROMOTION_UPGRADE_DEFERRED`, `CONTROL_PROMOTION_INVALID`, `CONTROL_PROMOTION_NOT_FOUND`, `CONTROL_PROMOTION_ENDED`, `CONTROL_PROMOTION_OVERLAP`, `CONTROL_PROMOTION_CAP_BELOW_USED`, `CONTROL_PROMOTION_CATALOG_STALE`. Existing `CONTROL_PREVIEW_STALE` / `CONTROL_REAUTH_REQUIRED` are reused.

## 5. Pure domain and admission seams (foundation lane)

`domain/billing-promotion.ts` (pure):

- `promotionOfferSignature(offer, tax)` = `configurationHash([1, offerKey, interval, intervalCount ?? 1, currency, priceSatang, tax, receiptAllowance])`
- `parsePromotionCampaigns(json)` strict; `parsePromotionCampaignsLenient(json)` (a parse failure = no campaign admissible, sales stay open); `parsePromotionDraft(values)` → `{ values, validationErrors }`
- `promotionTermsHash(campaign)` (excludes `paused`, `endedAt`)
- `promotionCampaignStatus(campaign, now, currentSignatures)` → SCHEDULED | ACTIVE | PAUSED | ENDED | CATALOG_STALE
- `assertPromotionPublication(before, after, offers, tax, takenByCampaign, now)`: immutable id; published campaigns never removed; ended campaigns immutable; `endsAt > startsAt`; no overlapping window on the same `offerKey + interval` among non-ended campaigns; release-1 template (Starter only, bonus 1 month / 30 units, base 30/360, monthly price 24,900 satang, signature = current offer); `cap === null || cap >= taken`; revision +1 when terms change.
- `promotionUnsupportedPurchase({ purchaseKind, purchaseMode, hasLiveSubscription, deal, upgrade, scheduledChange })` → reason | null (the §2 matrix)

`domain/billing-package.ts`: `promotionBoundaries({ serviceStartsAt, interval, anchorDay, bonusMonths })` → `{ paidEnd, benefitEnd }` with `paidEnd = appendPackageInterval(S, interval, anchorDay)` and `benefitEnd = appendPackageInterval(S, 'month', anchorDay, (interval === 'year' ? 12 : 1) + bonusMonths)`; `invoiceServiceEnd({ periodEnd, benefitEnd })` = `benefitEnd ?? periodEnd`.

`domain/billing-checkout-mode.ts`: `prepaidCardAuto(snapshot)` = `eventDiscountCardAuto(snapshot) || (purchaseMode === 'CARD_AUTO' && !!snapshot.promotion && !snapshot.repeat)`; `paymentCheckoutSnapshot` includes a promotion snapshot for the two auto modes. Never set `eventDiscount.choice` to fake it.

`application/billing-promotion.ts` (DB; mirrors `billing-event-discount.ts`):

```ts
promotionEnvironment(livemode): BillingPromotionEnvironment
lockPromotionFence(tx, env): Promise<void>                    // pg_advisory_xact_lock; MUST be the first lock of its transaction
promotionOffers(tx, { settings, companyId, offers, tax, now }): Promise<BillingPromotionOfferView[]>   // status view, no lock
promotionEligibility(tx, { settings, companyId, campaignId?, offer, tax, now }): Promise<{ ok: true; snapshot: BillingPromotionSnapshot } | { ok: false; reason }>
reservePromotion(tx, { snapshot, stripeAccountId, livemode, billingAccountId, companyId, attemptId, policyRevisionId, now }): Promise<true | BillingPromotionUnavailableReason>   // caller holds the fence; re-validates window, signature, revision/termsHash, cap, once-per-company
consumePromotion(tx, { attemptId, invoiceId, companyId, now }): Promise<boolean>     // idempotent for the same invoice
releasePromotion(tx, attemptId): Promise<void>                // RESERVED only; clears attemptId, releaseCount + 1; never touches CONSUMED
markPromotionApplied(tx, { invoiceId, paidStart, paidEnd, bonusEnd, now }): Promise<void>   // idempotent
promotionForInvoice(tx, invoiceId) / promotionForAttempt(tx, attemptId)
promotionUsage(tx, env, campaignId): Promise<{ reserved; consumed; taken }>
```

`application/billing-receipt-grants.ts`: `PROMOTION: 0` in `RECEIPT_LOT_GROUP`; the R7 comparator; `'PROMOTION'` in the `grantPaidPackageReceipts` kind union with a guard (`units >= 1`, `expiresAt === serviceEnd`); `promotionReceiptSourceKey(invoiceId)`; `grantPromotionPackageReceipts(tx, { companyId, billingAccountId, invoiceId, policyRevisionId, kind: 'INITIAL' | 'REPEAT', baseUnits, bonusUnits, serviceStart, paidEnd, benefitEnd, availableAt })` → `{ base, bonus }` (base: `sourceKey = invoiceId`, `serviceEnd = paidEnd`, `expiresAt = benefitEnd`; bonus: `promo:<invoiceId>`, `serviceStart = paidEnd`, `serviceEnd = expiresAt = benefitEnd`); `promotionSegments(db, billingAccountId)` → `{ lotId, invoiceId, start, end }[]` (non-revoked PROMOTION lots). The literal kind lists for REPEAT carry, grace and free days stay WITHOUT `PROMOTION` (that is what makes the bonus expiry fixed).

`BillingService.settings()` additionally returns `promotions` (lenient parse of the active revision's `promotionJson`).

## 6. Lanes and file ownership

One integration branch `claude/starter-249-promotion-20261009` in `/private/tmp/mangmee-promo-20261009`. The foundation lands first; every other lane works in its own worktree branched from the foundation commit and touches only its own files. Lanes never edit `package.json`, `.github/workflows/ci.yml`, or `scripts/line-ai-whole-chain-acceptance.catalog.mjs` — the controller registers new spec files at integration.

| Lane | Model | Owns |
| --- | --- | --- |
| F0 foundation | Opus (medium) | `schema.prisma`, the migration, contracts §4, §5 seams, `settings()` promotions, `domain/billing-promotion.spec.ts`, `billing-package.spec.ts` additions, `billing-promotion.pg.spec.ts` |
| A1 quote + checkout + status | Opus (medium) | `application/billing.service.ts` (quote, checkout reservation, barrier, resume, status/attempt/history views, R2 sites), `billing-purchase-source.ts`, `billing-upgrade.ts` (deferral guard), quote fields in `billing.dto.ts` / `billing.controller.ts`, `billing-promotion-checkout.pg.spec.ts` |
| A2 apply + renewal bind | Opus (medium) | `application/billing-reconciler.service.ts` (one-time apply boundaries, consume, release, bind at `benefitEnd`, zero-invoice skip, R2 sites), `billing-collection.ts`, `billing-checkout-expiry*.ts`, `billing-promotion-apply.pg.spec.ts` |
| B receipts + AI credit | Sonnet (max) | `line-ai/application/ai-credit-cycles.ts` (+ spec), tests for the receipt seams (`billing-receipt-allocator.spec.ts`, `receipt-addon-ledger.pg.spec.ts`, `billing-grace.pg.spec.ts`), comment in `billing-trial-carryover.ts` |
| C admin campaign API | Sonnet (max) | `application/billing-configuration.service.ts`, new `application/billing-promotion-campaigns.ts` (list/detail/report helpers), campaign routes in `billing.controller.ts` / `billing.dto.ts`, `billing-promotion-campaigns.pg.spec.ts` |
| D refund + end-package | Sonnet (max) | `application/billing-end-package.ts`, `billing-refunds.service.ts`, `billing-end-package.spec.ts` |
| E admin web | Sonnet (max) | new files under `apps/web/src/features/billing-admin/` (campaign list, form, detail, logic + spec), three routes under `apps/web/app/system/billing/campaigns/`, link in `BillingAdminPage.tsx` |
| F customer web | Sonnet (max) | `apps/web/src/features/billing/BillingPage.tsx`, `billing.api.ts`, new `billing-promotion.ts` (+ spec), return/status copy |
| H texts + docs | Haiku (max) | Thai texts for the §4 error codes (`api-error-message.ts`, `billing-error-text.ts` + spec), D8 group table in `docs/specs/chat-credit-and-receipt-addons-spec-th.md` |

`billing.controller.ts` / `billing.dto.ts` are shared by A1 (quote fields) and C (campaign routes): distinct hunks, merged by the controller. `apps/web/app/system/layout.tsx` is pinned by the production-maintenance validator and must not be edited (the campaign link lives in the in-page billing navigation).

### Purchase-flow rules (A1, A2)

- Quote body gains `benefitChoice?` and `promotionCampaignId?`. Absent `benefitChoice` keeps today's behaviour exactly (EVENT_DISCOUNT when a ticket is offered and `eventDiscountChoice !== 'DECLINE'`, else NORMAL); it never defaults to PROMOTION. PROMOTION records `eventDiscount: { choice: 'DECLINE' }` when a ticket exists and never reserves it; EVENT_DISCOUNT/deal never carry a promotion snapshot.
- A PROMOTION quote that is not eligible throws `PROMOTION_UNAVAILABLE` + reason; it never silently falls back to NORMAL.
- `BillingQuote.purchase.projectedPaidThrough` stays `paidEnd` (trial-carryover expiry stays `paidEnd`, G13); promotion dates go in `BillingQuote.promotion`.
- Checkout: pre-read the quote without a lock; when it holds a promotion, take the fence first, then the existing locks; `reservePromotion` runs right after the attempt row and `activeAttemptId` are written, in the same transaction; a refusal aborts with `PROMOTION_UNAVAILABLE`.
- Barrier / resume: R3. Auto modes use a payment-mode Checkout at the full snapshot price via `prepaidCardAuto`; one-time modes are unchanged.
- Release at the three proven-unpaid points that release the event ticket today (`billing.service.ts:827`, reconciler `:84`, `:513`). Consume beside `useEventDiscount` (before the applied-row return and the HELD exit; also in import mode).
- One-time apply: `S`, `paidEnd`, `benefitEnd` from `promotionBoundaries`. `invoice.periodEnd = paidEnd`, `invoice.benefitEnd = benefitEnd`, trial carryover `periodEnd = paidEnd`, base + bonus lots via `grantPromotionPackageReceipts`, `termEndsAt = account.paidThrough = benefitEnd`, HELD test and bind `trial_end` = `benefitEnd`, `markPromotionApplied`.
- Renewal invoices (`applyInvoice`) take dates from Stripe line periods and must never read `snapshot.promotion`; the bound contract's stored snapshot must not grant the bonus again. The $0 trial invoice is skipped for `prepaidCardAuto`.

## 7. Verification

GitHub Actions has been in `startup_failure` (zero jobs) since late September, so the local run is the gate.

- Typecheck api + web with the native TypeScript 7 compiler CI uses (serialized by a lock).
- Focused `tsx --test` on every touched or new spec file; `apps/api/src/spec-suite-coverage.spec.ts`; the web suite.
- PostgreSQL specs against a throwaway local database migrated from an empty one (`prisma migrate deploy`), including the existing `billing-event-discount.pg.spec.ts`, `billing-event-discount-renewal.pg.spec.ts`, `receipt-addon-ledger.pg.spec.ts`, `billing-cash-movements.pg.spec.ts` as regressions.
- `prisma validate`, `test:boot`, `node apps/api/scripts/check-di-metadata.mjs`, the maintenance-pins `--check`, `node scripts/run-line-ai-whole-chain-acceptance.mjs`.
- Independent review of the integrated diff before merge.

Not verifiable here (recorded as debt, not claimed): native Stripe test-mode behaviour, browser acceptance at 390 px and desktop, UAT.

## 8. Acceptance map

Filled in at integration: each of A01–A36 → the spec file and test that proves it, or the explicit reason it is refused/deferred in release 1.
