# Plan: Starter 249 bonus-month promotion — release 1

Status: RELEASE 1 IMPLEMENTED on the feature branch (2026-10-09); no campaign exists, so the capability is inert. Acceptance map in §8; open items in §9. Spec: [starter-249-bonus-month-promotion-spec-th.md](../specs/starter-249-bonus-month-promotion-spec-th.md). Memory: [agent-memory](../agent-memory/starter-249-bonus-month-promotion.md).

Base: `origin/main` `7d2f21fae` (tree identical to `origin/develop`). The billing module is byte-identical to the spec's base "M" except `schema.prisma` (+32 lines) and one migration.

This plan is the binding contract for every implementation lane. Where it differs from the spec's literal wording, §1 says why; the spec's product rules (§2, Q1–Q6) are unchanged.

## 1. Review findings that change the literal design

Five read-only source reviews ran before this plan. These findings are decisions, not options.

| ID | Finding (verified in source) | Decision |
| --- | --- | --- |
| R1 | A new key inside `policyJson` makes an older API binary fail `parseBillingPolicy` and close **all** sales (`billing-policy.ts:30`, `billing.service.ts:166`). The general settings page also round-trips the whole policy and `saveDraft` parses strictly, so incomplete campaign drafts are impossible there. | Campaign terms live in a sibling nullable column `BillingPolicyRevision.promotionJson` (`Record<campaignId, campaign>`). `publish()` writes `proposed.promotions ?? <current revision's promotionJson>`, so a general publish can never drop or edit campaigns and a campaign publish carries the policy unchanged. Incomplete drafts are `BillingOperation` rows of type `PROMOTION_CAMPAIGN_DRAFT` (`type` is a String; no migration). |
| R2 | Eight readers assume `invoice.periodEnd == account.paidThrough` (`billing.service.ts:187, 634, 867`; `billing-purchase-source.ts:18`; `billing-end-package.ts:29`; reconciler `:602, :752, :971, :1058, :1069`). With `paidThrough = benefitEnd` and `periodEnd = paidEnd` a healthy promo shop becomes `SOURCE_INCONSISTENT` and can buy nothing. The spec names only end-package. | One nullable column `BillingInvoice.benefitEnd` (service end including the free time; null = `periodEnd`) and ONE helper `invoiceServiceEnd(invoice)`. Every equality above compares `invoiceServiceEnd(invoice)` to `paidThrough`. The financial period (`periodStart/periodEnd`) is never stretched. |
| R3 | The pre-dispatch barrier fails an attempt when the policy revision id or settings version changed after the reservation commit (`billing.service.ts:729-730`), and `resume()` hides the URL (`:1111`). Every pause/end publishes a new revision, so a RESERVED right would be withdrawn — against spec §6 / A04 / A30. | For EVERY attempt (review finding: pause/end are one-step commands and must not stop a normal buyer either), the barrier and `resume()` treat a new revision or settings version as unchanged when `configurationHash(currentRevision.policyJson) === configurationHash(attemptRevision.policyJson)` (`basePolicyUnchanged`). The `new_sales` and payment-mode gates are read as before, and `plan_changes` is re-read for an upgrade or a scheduled change. A base-policy change in that sub-second window still fails closed (release + re-quote). Quote staleness at Checkout is unchanged: any publication asks for a fresh quote. |
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
| R15 | Review: the console showed `CATALOG_STALE` while the other cycle of the same campaign kept reserving. | A stale signature on ANY rule stops admission for the whole campaign (spec §4); NORMAL stays purchasable. |
| R16 | Review: a right reserved for a Checkout that was never requested (process died before the barrier) stayed RESERVED forever and held a cap seat; nothing read `createBy`. | The reconciler releases it once `createBy` has passed, only when the attempt is still `CREATING` with no session and nothing exists at the provider (spec §6). An attempt that reached `REQUESTING`/`UNKNOWN` is never released by elapsed time: it stays in review and keeps its cap seat. |
| R17 | Review: `endPackageBlock` answers NOT_CURRENT before it looks at the renewal, and a promotion refund tolerates NOT_CURRENT, so a full refund could leave a usable bonus lot and a future charge. | While the source's service is not over and the renewal is live, the refund is refused (`BILLING_END_PACKAGE_AUTO_RENEW`) even when NOT_CURRENT is tolerated. A succeeded full refund whose entitlement could be neither ended nor stamped opens a `PROMOTION_REVIEW` issue on the invoice; the report then answers REVIEW. |
| R18 | Review: one historical overlap between a free time and a paid period switched AI credit off at every instant, forever. | Runs that are over before the run in force starts are ignored; an overlap among the runs still in force or ahead returns null. |
| R19 | Review: the package page sent the new `benefitChoice` field for a shop that only holds a sales-event ticket, which changes the API's answer for existing shops before any campaign exists. | The page sends the new fields only when an available promotion row exists for the card being quoted; otherwise the request is byte-for-byte the one from before this feature. |

## 2. Release-1 scope

**Supported promotion purchases**

| Purchase | Modes |
| --- | --- |
| INITIAL (new shop, legacy trial) and RESTART (expired paid) | CARD_ONCE, PROMPTPAY_ONCE, CARD_AUTO, PROMPTPAY_RENEW |
| REPEAT on an active one-time Starter of the same interval (continues from `paidThrough`) | CARD_ONCE, PROMPTPAY_ONCE |

**Refused with `PROMOTION_UNAVAILABLE` + reason `PURCHASE_KIND_UNSUPPORTED` (NORMAL stays purchasable)**: repeat on a live CARD_AUTO subscription; any scheduled change (cadence or tier) as the promo purchase; upgrade; sales deal / advance deal. Already refused today for every purchase: active PROMPTPAY_RENEW, a subscription still trialing, a pending plan change, holds.

**After a promotion purchase**: immediate upgrade (differential or full-package) while a promotion purchase still gives service → `PROMOTION_UPGRADE_DEFERRED` with the date of the latest promotion `benefitEnd` (the block lifts there; a normal repeat stacked after it follows the normal guards); stop/resume renewal works while the bound subscription is trialing; grace and sweep read `termEndsAt = benefitEnd`; partial refund keeps everything; verified cumulative-full refund ends the source's unused entitlement; dispute keeps today's `FINANCIAL_REVIEW` hold.

**Deferred (documented, not built)**: repeat on a live CARD_AUTO subscription (needs Stripe test-mode proof of the 13-month zero-price phase); promo on scheduled changes; automatic entitlement adjustment for a full refund of a not-yet-started (future) promo source and for dispute won/lost (staff-handled, state shows PENDING/REVIEW); automatic release of a reserved right on an attempt that reached REQUESTING/UNKNOWN without a session (it stays in review and keeps its cap seat, per spec §6; R16 covers the never-requested case); provider-account migration; marketing-site copy (separate repository); native Stripe test-mode proof and browser acceptance on UAT.

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
- Browser: `e2e/billing-promotion.spec.ts` renders every state of the Admin and the customer screens at 390 px and 1280 px against a simulated Billing API (`e2e/billing-promotion.fixture.ts`). It proves the screens, not the payment provider.

Not verifiable here (recorded as debt, not claimed): native Stripe test-mode behaviour, browser acceptance against a real API on UAT.

## 8. Acceptance map

"Proven" means a registered test passes against the merged code. PostgreSQL specs run against a database migrated from empty; the payment provider in every one of them is a FAKE Stripe, so no row below claims native provider behaviour (§9). Spec files are under `apps/api/src/modules/billing/` unless a path says otherwise.

| ID | Status in release 1 | Evidence or reason |
| --- | --- | --- |
| A01 | Proven | `billing-promotion-checkout.pg.spec.ts` (quote: 2 / 13 months, 60 / 390 units; Basic refused `OFFER_NOT_COVERED`), `billing-promotion-apply.pg.spec.ts` (applied month and year) |
| A02 | Partly | New shop / legacy trial (INITIAL) and an active one-time Starter (REPEAT) proven in the apply and checkout specs; RESTART uses the same apply path but has no test of its own; an active auto-renewal is refused in release 1 (A12) |
| A03 | Proven | `billing-promotion.pg.spec.ts` (once per company per campaign, a second campaign allowed, TEST and LIVE separate), checkout spec (same shop refused while RESERVED and after CONSUMED) |
| A04 | Proven | checkout spec (a pause or end published between reservation and dispatch does not stop the dispatch; a base-policy change does), `billing-promotion-campaigns.pg.spec.ts` (a new revision keeps usage) |
| A05 | Proven | `domain/billing-package.spec.ts` (31 Jan, leap day, Dec → Jan, early-morning Bangkok), apply spec (31 Jan → 28 Feb → 31 Mar) |
| A06 | Proven | apply spec (a repeat continues from the old `paidThrough` and keeps the anchor day); checkout spec journey (a normal repeat after a promotion starts at `benefitEnd`) |
| A07 | Proven | apply spec (base + bonus lots, once; replay grants nothing), `receipt-addon-ledger.pg.spec.ts` |
| A08 | Proven | `application/billing-receipt-allocator.spec.ts`, `receipt-addon-ledger.pg.spec.ts` (own expiry and group per kind; unknown kind fails closed) |
| A09 | Proven | `line-ai/application/ai-credit-cycles.spec.ts`, `line-ai/application/ai-credit-funding.pg.spec.ts` (funded once, not after revoke, none for gift days) |
| A10 | Proven | apply spec (one-time apply exactly once; expired unpaid releases), checkout spec (provider rejection releases, UNKNOWN does not) |
| A11 | Proven with the fake provider | apply spec and checkout spec journey: payment now, subscription bound with `trial_end = benefitEnd`, the $0 trial invoice grants nothing, the first renewal has base units only |
| A12 | Refused by design | Repeat on a live card subscription answers `PROMOTION_UNAVAILABLE` / `PURCHASE_KIND_UNSUPPORTED` and NORMAL still quotes (checkout spec); R10 |
| A13 | Partly | Stop/resume while the bound subscription trials (`application/billing-collection.spec.ts`); grace does not stretch the bonus lot (`billing-grace.pg.spec.ts`, run by hand — it is registered nowhere); a scheduled downgrade or cadence change while trialing is refused as before |
| A14 | Proven | `application/billing-upgrade.spec.ts`, checkout spec journey (`PROMOTION_UPGRADE_DEFERRED`, `upgradeDeferredUntil`); the date is told, a scheduled upgrade is not created for the buyer |
| A15 | Proven | `billing-promotion.pg.spec.ts` (before start, ended, paused, cap full, cap race under the fence), apply spec (a reserved Checkout paid after the end still applies) |
| A16 | Proven | apply spec (replay of the paid event, HELD → retry, late paid proof) |
| A17 | Proven | checkout spec (PROMOTION leaves the ticket untouched, EVENT_DISCOUNT leaves the campaign untouched; a quote without `benefitChoice` is unchanged) |
| A18 | Partly | `application/billing-end-package.spec.ts`: partial keeps everything, cumulative-full ends the running source and revokes base + bonus, the renewal guard, the stamp, replay. A source that has not started, is held, or was replaced stays PENDING / REVIEW for staff; dispute handling is unchanged |
| A19 | Proven | campaigns spec (permission, reauthentication, stale versions), checkout spec (the client sends only a choice and a campaign id) |
| A20 | Partly | One contract feeds card, review, status, history and Admin; web logic specs; browser run in §9 |
| A21 | Not proven | No mixed-version or rollback test. Rollout rule R8: after the first promotion purchase never roll back past this release |
| A22 | Partly | Report counts and money gating (campaigns spec); first-activation attribution keeps its existing one-row-per-company rule; the marketing site is a separate repository |
| A23 | Proven (API) | campaigns spec (template, incomplete draft, reload, not in the catalog, preview 2 / 60 and 13 / 390) |
| A24 | Proven (API) | campaigns spec (publish through submit + approve; a campaign publication carries policy and gates unchanged) |
| A25 | Proven | campaigns spec (pause is immediate for `reservePromotion`, resume keeps usage, an ended campaign cannot reopen) |
| A26 | Proven | campaigns spec (stale publish refused, another campaign never overwritten, retried create and pause do not duplicate) |
| A27 | Browser run in §9 | `apps/web/src/features/billing-admin/billing-campaigns.logic.spec.ts` for the logic |
| A28 | Proven | `domain/billing-promotion.spec.ts`, `billing-promotion.pg.spec.ts`, campaigns spec (stale signature stops the whole campaign; a 50/600 catalog cannot be republished under the template) |
| A29 | Partly | Uniqueness is per environment, not per provider account (`billing-promotion.pg.spec.ts`); carrying campaigns across a provider-account change is not built (R12) |
| A30 | Proven | checkout spec (reserve → pause → dispatch; never-requested attempt released after `createBy`; REQUESTING / UNKNOWN not released), apply spec (paid after the end) |
| A31 | Proven | `receipt-addon-ledger.pg.spec.ts` (bonus first on equal expiry, base carried and bonus fixed, 60 not 40 or 70, reserve → expiry → consume) |
| A32 | Proven | `ai-credit-cycles.spec.ts` (tail and gap give the same cycle, 31 Jan clamp, gift days, anchor chain) |
| A33 | Partly | Journey: PENDING → REVIEW → READY and a lost bind request bound once. Stopping renewal while PENDING is not offered (the control appears once bound) |
| A34 | Proven | checkout spec (`PROMOTION_UNAVAILABLE` with its reason, no silent fallback), `apps/web/src/features/billing/billing-promotion.spec.ts` (one choice, exact request fields) |
| A35 | Partly | As A18 |
| A36 | Proven | `billing-promotion.pg.spec.ts` (two concurrent reservations at cap 1 admit one), campaigns spec (cap below reserved + consumed refused at approve even when the preview came first) |

## 9. Verification record and open items

Local gate on the integrated branch (GitHub Actions is in `startup_failure`, so this is the gate): prisma validate, native TypeScript typecheck of api and web, the other packages' typechecks, DI metadata check, maintenance pins, every package's unit suite, the two billing acceptance steps, harness manifests, the LINE-AI whole-chain acceptance, boot, and the whole PostgreSQL step of `ci.yml` against a database migrated from empty. Results of the final run are in the pull request.

Three independent reviews of the integrated diff (purchase money path; Admin API, refunds and AI credit; web against the API as built) found no P1 in the API and one P1 wire regression in the web; their findings are R15–R19 above and the fix commits on the branch.

Open before a campaign is opened to real customers:

1. Native Stripe test mode on UAT — walked 2026-10-09/10 (see "UAT walk" below). Still unproven: the annual offer in the auto-renew card mode (the 13-month deferral was proven with the QR-bill mode), and the first renewal charge or bill at `benefitEnd` (a future date).
2. Browser acceptance on UAT — walked at phone width for the Admin and the customer journeys (same walk). Not walked: desktop width on UAT, a full refund with "keep the package", a dispute, resuming a paused campaign.
3. Repeat on a live card subscription and a promotion on a scheduled change (refused today, R10).
4. Automatic entitlement adjustment for a fully refunded promotion source that has not started, is held or was replaced, and for dispute outcomes (staff today; the report shows PENDING / REVIEW).
5. `billing-grace.pg.spec.ts` is registered in no test runner; it was run by hand for this work.
6. The UAT re-test of the fixes from the walk — done 2026-10-10 on source `e414d3a24` (see "UAT re-test" below); the release was promoted to Production the same morning. Still unproven by a real turn: the LINE event-discount sentence for a QR-bill shop.
7. `e2e/billing-promotion.spec.ts` ran for real on 2026-10-10 (259 tests with the three older billing specs, 0 failed): the simulated-API screens at 390 px and 1280 px. It found FXE-D14, fixed in #1059: a long unbroken campaign name stretched the chooser and the plan cards past a phone screen.
8. A shop whose renewal is switched off is still told that it renews, on the web event-discount note and in the LINE reply (older text, not from this work).
9. The in-app refund review cannot open for an invoice paid by PromptPay QR (409 `CONTROL_REFUND_SOURCE_CHANGED`; older than this work; likely the `ch_`-only charge id check against Stripe's `py_` ids). A promotion purchase paid by QR therefore cannot be refunded in the app until it is fixed; the refund rules for a QR purchase (a partial refund keeps everything; a cumulative-full refund ends the unused entitlement and the right stays used) are unproven on UAT. **Cause proven 2026-10-10** on the UAT database: all 9 paid PromptPay invoices store a `py_` charge id (17 card ones `ch_`); the settlement check of 2026-10-09 also filed the three QR payments as "other items" (movement type `payment`). **Fix written the same day** (refund review, refund observation and settlement check accept `py_`/`pyr_` ids and read `payment`/`payment_refund` movements as charge/refund; tests in the two registered spec files). **UAT, 2026-10-10 10:22 (source `f32871073`):** the refund review opens for every QR-paid invoice and the settlement check of 2026-10-09 matches all five payments; but a real sandbox refund of a QR payment was REJECTED by the provider at `POST /credit_notes` (operation left `UNKNOWN`, review case opened, reason not recorded anywhere on our side). Not promoted to Production; see `docs/runbooks/cloud-environment-operations.md`, "Release 2026-10-10 10:22". Next: read the provider's reason in the Stripe sandbox dashboard, then make the refund work or refuse a QR refund at the review with a clear sentence.

### UAT walk, 2026-10-09 23:00 – 2026-10-10 00:06 (Stripe test mode, source `7cb86fa0e`)

One TEST campaign from the Starter template ("ซื้อ Starter แถม 1 เดือน", cap 5, one week), created, checked, submitted and approved by the System Admin; then every right used through the customer screens, the Admin report read, and the campaign paused and ended. The owner signed in, typed his password at each re-authentication, typed the one test card and pressed the two refund approvals; PromptPay test payments need no card.

| Case | Shop state before | Result read from the screens and the API |
|---|---|---|
| Auto-renew card, monthly | expired | 249 THB; service to +2 months; 60 receipts; right CONSUMED; renewal READY; subscription `trialing`, next charge at `benefitEnd`; invoice period = the paid month |
| Pay-once card, monthly | expired | 2 months, 60 receipts, no next charge |
| PromptPay, bill every period, monthly | expired | 2 months, 60 receipts, subscription `trialing`, QR bill at `benefitEnd` |
| PromptPay, bill every period, annual | expired | 2,490 THB; 13 months; 390 receipts; renewal PENDING for a few seconds, then READY; next bill 13 months out |
| Repeat, PromptPay pay-once | active pay-once Starter | new end stacked after the current one; receipts 30 + 60 |
| Started, not paid, cancelled | expired | block with three ordered choices; "continue paying" reopened the same Checkout; cancel released the right (attempt EXPIRED) |
| Cap | — | a reserved right counts: other shops saw `CAP_FULL` while the fifth was reserved, again after it was consumed |
| Refusals | auto-renew Starter, other tiers, used shop | `PURCHASE_KIND_UNSUPPORTED`, `ALREADY_USED`; each shows a reason and leaves the normal purchase |
| Admin report | — | used 5, cancelled before payment 1, received 3,486 THB, free months 5, bonus receipts 150 |
| Partial refund 100 THB, keep | pay-once shop | time and receipts unchanged; report: refunds 1, refunded 100 THB, used still 5 |
| Remainder 149 THB, end the package now | same shop | package and receipts ended; right still used (used 5, still active 4, fully refunded 1, refunded 249 THB); the `FINANCIAL_REVIEW` issue opened by the refund is the older behaviour of every refund |
| Pause, end | — | PAUSED with "resume" offered; ENDED, history kept |

Defects found on the walk (none in the money path) and fixed in the follow-up change: an amber alert with a support reference after a promotion purchase in the two renewing modes; a chooser sentence untrue for packages without the promotion; the shell banner on the return address during an unfinished payment; the event-discount note calling a QR-bill shop "auto-charged"; the cancel notice shown together with the old pending block for a few seconds; the Admin refund review silent about the promotion; the Admin campaign page saying shops can use a right while the cap is full.

### UAT re-test, 2026-10-10 07:04–07:25 and 09:30–09:45 (Stripe test mode, source `e414d3a24`)

A second TEST campaign ("ซื้อ Starter แถม 1 เดือน (รอบทดสอบ 2)", cap 2, one week). The owner typed his password at the re-authentication and signed in (shop owner, then System Admin); the agent did the rest. PromptPay sandbox payments need no card.

| Case | Result read from the screens and the API |
|---|---|
| After a promotion purchase, renewing modes (auto-renew card; QR bill monthly; QR bill annual) | no amber alert; a quiet line says when the package can be changed |
| Event-discount note per renewal mode | QR-bill shop: the QR-bill sentence; card shop: the card sentence; pay-once chooser: "ลดเฉพาะการจ่ายครั้งนี้" |
| Chooser sentence | "ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ โปรโมชั่นใช้ได้เฉพาะแพ็กเกจที่แสดงโปรโมชั่น แพ็กเกจอื่นซื้อตามที่แสดงไว้ที่แพ็กเกจนั้น" |
| Return address with an unfinished payment | shell banner shows its first clause only; block with three ordered choices; the reserved right is named |
| Cancel before paying | the old block stays until the read, then the chooser with the notice; never both; the right is offered again; the report counts 1 cancelled |
| QR bill every period, monthly (expired shop) | 249 THB; Starter for 2 months; 60 receipts; right CONSUMED; next QR bill at the end of the free month |
| QR pay-once, ANNUAL (shop with no package; not walked before) | 2,490 THB; 13 months; 390 receipts; no next charge |
| Cap 2 of 2 | every other shop reads `CAP_FULL`; the card says "สิทธิ์โปรโมชั่นครบจำนวนแล้ว" and keeps the normal purchase and the event discount |
| Admin campaign page at the cap | "สิทธิ์ครบจำนวนแล้ว (2 จาก 2) ร้านที่ยังไม่ได้จองสิทธิ์เลือกใช้โปรโมชั่นนี้ไม่ได้ ส่วนการซื้อแพ็กเกจแบบปกติเป็นไปตามเดิม" |
| Admin report | used 2, still active 2, cancelled before payment 1, free months 2, bonus receipts 60, received 2,739 THB |
| Refund review, card-paid promotion invoices | 200 with the promotion block |
| Refund review, QR-paid invoices | 409 `CONTROL_REFUND_SOURCE_CHANGED` for every one, promotion or not (two normal purchases of 2026-09-29 included): an older defect of the refund path, recorded in `docs/runbooks/cloud-environment-operations.md`, "Release 2026-10-10 09:41"; open item 9 |
| A shop owner opening the Admin campaign page | "ไม่มีสิทธิ์เข้าถึง" |

Seen on the way, older and not from this work: a shop whose card charge failed (subscription cancelled, in grace) shows the amber "การซื้อซ้ำหรือเปลี่ยนแพ็กเกจระหว่างรอบยังไม่เปิดให้บริการ" and the "auto-charged" event-discount sentence (open item 8); the review step says "ชำระสำเร็จแล้ว ใช้งานได้ 2 เดือน" before paying, which reads as "once paid" but could be clearer.

