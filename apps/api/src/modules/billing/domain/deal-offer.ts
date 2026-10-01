/**
 * A sales deal expressed as a `BillingOffer`, so it can ride PR #667's one-time purchase path
 * without a second Checkout, a second evidence reader or a second apply
 * (spec docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §19.2, S35/S36/S38/S39).
 *
 * Everything here is pure: the row, the pinned snapshot and the gates decide the answer.
 */
import { ALL_FEATURE_ENTITLEMENT_KEYS, PLAN_TIER_PRESETS, type BillingAction, type BillingOffer, type BillingPurchaseMode,
  type SalesDealCadence, type SalesDealSnapshot } from '@watchdog-bms/contracts';
import { autoRenewOf, buildDealSnapshot, DEAL_KIND, SalesSnapshotError } from '../../sales-console/domain/sales-deal.logic';
import { appendPackageInterval } from './billing-package';
import { billingError, configurationHash } from './billing-policy';

/** What the quote pins into `BillingSnapshot.deal`; the apply reads it back without a second lookup. */
export type DealSource = { requestId: string; snapshotHash: string; months: number; salesUserId: string;
  aiMonthlyBudgetSatang: number | null;
  /** v2/v3 = TOTAL; v4 = CHAT. Absent on old pinned invoices means TOTAL. */
  creditScope?: 'CHAT' | 'TOTAL';
  /** D-P5-1: the cycle an auto-renewing deal bills on; absent on every one-time deal. The apply
   *  credits the agent with ONE cycle, not `months`, which an auto-renewing deal does not use. */
  cadence?: SalesDealCadence | null;
  /** D-P5-6: N cycles then back to the catalog price, or `null` = until the lead ends it. */
  cycles?: number | null };

/** The `PackageChangeRequest` columns a deal purchase reads. */
export type DealRequestRow = { id: string; companyId: string; kind: string; status: string; salesUserId: string | null;
  offerSnapshotJson: unknown; offerExpiresAt: Date | null;
  /** D-P5-3: the shop's own Stripe Price, created at approval. Null on every one-time deal. */
  stripePriceId?: string | null; priceState?: string | null };

const notFound = () => billingError('BILLING_DEAL_NOT_FOUND', 'ไม่พบข้อเสนอพิเศษนี้ กรุณาเปิดหน้าแพ็กเกจอีกครั้ง');
const mismatch = () => billingError('BILLING_DEAL_SNAPSHOT_MISMATCH', 'ข้อเสนอพิเศษเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่');

/** PostgreSQL JSONB may reorder keys, so the pinned hash is order-insensitive by construction. */
export function dealSnapshotHash(offerSnapshotJson: unknown): string {
  return configurationHash(offerSnapshotJson);
}

/**
 * The deal as an offer (S35). For a ONE-TIME deal `intervalCount` is the whole point: N months are
 * sold, charged and appended once, so `appendPackageInterval` keeps the anchor day instead of
 * walking short months. For an AUTO-RENEWING deal (D-P5-2) it is always 1 and `interval` is the
 * cadence, because that is the only shape a Stripe recurring Price can take.
 */
export function dealOffer(snapshot: SalesDealSnapshot): BillingOffer {
  const auto = autoRenewOf(snapshot);
  const preset = PLAN_TIER_PRESETS[snapshot.base];
  // D-P5-2: one cycle, `intervalCount` 1 — the only shape `assertStripePrice` and
  // `paidInvoiceEvidence` accept for a recurring Price. `months` is not part of an auto deal.
  const cycles = auto.autoRenew ? 1 : snapshot.months;
  const interval = auto.cadence ?? 'month';
  return {
    offerKey: snapshot.base, interval, intervalCount: cycles,
    label: `${preset.labelTh} · ข้อเสนอพิเศษ`, priceSatang: snapshot.priceSatang, currency: 'THB',
    branchLimit: snapshot.branchLimit, employeeLimit: snapshot.employeeLimit, monthlySlipLimit: snapshot.monthlySlipLimit,
    receiptAllowance: snapshot.monthlySlipLimit * (interval === 'year' ? 12 : 1) * cycles, receiptAllowanceCadence: 'PAID_PERIOD',
    // Phase 6: a deal sells its own menu set, not the base tier's. The same field the catalog
    // offer carries, so one reader answers both cards.
    featureKeys: [...snapshot.featureKeys],
    availability: 'AVAILABLE', reason: null,
  };
}

/** D-P5-2 — the auto-renewing half of `dealOffer`, named for the Price it is validated against. */
export function autoRenewDealOffer(snapshot: SalesDealSnapshot, cadence: SalesDealCadence): BillingOffer {
  return dealOffer({ ...snapshot, autoRenew: true, cadence });
}

/**
 * D-P5-6 — when a fixed-cycle deal goes back to the catalog price: the end of cycle N counted from
 * the instant the first cycle started, keeping the anchor day. `null` = until revoked, which has no
 * date at all until a lead presses "จบดีล".
 *
 * `appendPackageInterval` is the walker the paid term itself uses, so a return can never land on a
 * day a renewal would not.
 */
export function dealReturnAt(periodStart: Date, cadence: SalesDealCadence, cycles: number | null, anchorDay?: number): Date | null {
  return cycles === null ? null : appendPackageInterval(periodStart, cadence, anchorDay, cycles);
}

/** The stored offer, re-validated by the same rules that froze it — a row is not trusted input. */
export function dealSnapshot(offerSnapshotJson: unknown): SalesDealSnapshot {
  const raw = offerSnapshotJson as (SalesDealSnapshot & Record<string, unknown>) | null;
  // D-P5-1: v2 (one-time only) and v3 (auto-renew aware) are both live in the table. A v2 row
  // rebuilds as an explicit `autoRenew: false` deal; nothing rewrites the stored JSON, and the
  // pinned hash is taken from that untouched JSON, so re-reading an old row stays byte-stable.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.version !== 2 && raw.version !== 3 && raw.version !== 4)) throw mismatch();
  // Stored offers predate the current Sale picker. Preserve their pinned terms while new writes
  // continue to use the narrower allowlist in buildDealSnapshot.
  // B3: the rebuild is also where a stored deal that names a parent menu alone gains that parent's
  // submenus, so the offer card, the feature plan and the list of menus that stop all agree.
  try { return buildDealSnapshot(raw, raw.version, ALL_FEATURE_ENTITLEMENT_KEYS); } catch (error) {
    if (error instanceof SalesSnapshotError) throw mismatch();
    throw error;
  }
}

/**
 * S36/S46 — the row must still be this company's live, APPROVED offer, and (once a quote exists)
 * byte-for-byte the offer that quote was priced from. `unit_amount` is never read from a request
 * body: it comes from the snapshot this function has just verified.
 *
 * Expiry is judged at quote and at Checkout-session creation only. A session created inside the
 * window and paid after it still applies — the price was locked when the customer was asked to pay.
 */
export function assertDealSnapshot(row: DealRequestRow | null, companyId: string, now: Date, pinned?: DealSource): SalesDealSnapshot {
  if (!row || row.kind !== DEAL_KIND || row.companyId !== companyId || !row.salesUserId ||
      row.status !== 'APPROVED' || !row.offerExpiresAt) throw notFound();
  if (row.offerExpiresAt <= now) throw billingError('BILLING_DEAL_EXPIRED', 'ข้อเสนอพิเศษนี้หมดอายุแล้ว กรุณาติดต่อทีมงาน');
  const snapshot = dealSnapshot(row.offerSnapshotJson);
  const auto = autoRenewOf(snapshot);
  if (pinned && (pinned.requestId !== row.id || pinned.salesUserId !== row.salesUserId || pinned.months !== snapshot.months ||
      pinned.aiMonthlyBudgetSatang !== snapshot.aiMonthlyBudgetSatang ||
      (pinned.creditScope ?? 'TOTAL') !== (snapshot.version === 4 ? 'CHAT' : 'TOTAL') ||
      (pinned.cadence ?? null) !== auto.cadence || (pinned.cycles ?? null) !== auto.cycles ||
      pinned.snapshotHash !== dealSnapshotHash(row.offerSnapshotJson))) throw mismatch();
  return snapshot;
}

/** The pinned offer must still be exactly what this deal sells (price, months, limits, label). */
export function assertDealOfferUnchanged(snapshot: SalesDealSnapshot, pinnedOffer: BillingOffer): void {
  if (configurationHash(dealOffer(snapshot)) !== configurationHash(pinnedOffer)) throw mismatch();
}

/**
 * S39 — the deal card computes its OWN payment modes. `availablePurchaseModes` answers the
 * catalog and is filtered by the account's current renewal family; a deal is sold on the family
 * ITS OWN snapshot asks for (one-time, or renewing when `autoRenew`), and a shop with a live
 * subscription is refused at quote instead.
 *
 * S38/D-P3-7: Stripe's PromptPay documentation states no per-transaction maximum for THB
 * (https://docs.stripe.com/payments/promptpay, read 2026-09-21 — it lists presentment currency,
 * refunds and disputes, no amount ceiling). The limit a customer actually meets is their own bank
 * app's transfer limit, which we cannot see, so no cap is encoded here. If Stripe ever publishes
 * one, hide PROMPTPAY_ONCE above it in this function.
 */
export function dealPurchaseModes(gates: Partial<Record<BillingAction, boolean>>,
  snapshot?: SalesDealSnapshot | null): BillingPurchaseMode[] {
  if (!gates.new_sales) return [];
  // D-P5-4/Q8: an auto-renewing deal is sold on the two renewing modes and NEVER on a one-time
  // one — the price it pins is a recurring Stripe Price. `CARD_AUTO`'s own gate IS `new_sales`
  // (`gateForMode`), which the line above already required.
  const modes = autoRenewOf(snapshot).autoRenew
    ? ([['CARD_AUTO', 'new_sales'], ['PROMPTPAY_RENEW', 'promptpay_renew']] as const)
    : ([['CARD_ONCE', 'card_once'], ['PROMPTPAY_ONCE', 'promptpay_once']] as const);
  return modes.filter(([, gate]) => gates[gate] === true).map(([mode]) => mode);
}
