/**
 * A sales deal expressed as a `BillingOffer`, so it can ride PR #667's one-time purchase path
 * without a second Checkout, a second evidence reader or a second apply
 * (spec docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §19.2, S35/S36/S38/S39).
 *
 * Everything here is pure: the row, the pinned snapshot and the gates decide the answer.
 */
import { PLAN_TIER_PRESETS, type BillingAction, type BillingOffer, type BillingPurchaseMode,
  type SalesDealSnapshot } from '@watchdog-bms/contracts';
import { buildDealSnapshot, DEAL_KIND, SalesSnapshotError } from '../../sales-console/domain/sales-deal.logic';
import { billingError, configurationHash } from './billing-policy';

/** What the quote pins into `BillingSnapshot.deal`; the apply reads it back without a second lookup. */
export type DealSource = { requestId: string; snapshotHash: string; months: number; salesUserId: string;
  aiMonthlyBudgetSatang: number | null };

/** The `PackageChangeRequest` columns a deal purchase reads. */
export type DealRequestRow = { id: string; companyId: string; kind: string; status: string; salesUserId: string | null;
  offerSnapshotJson: unknown; offerExpiresAt: Date | null };

const notFound = () => billingError('BILLING_DEAL_NOT_FOUND', 'ไม่พบข้อเสนอพิเศษนี้ กรุณาเปิดหน้าแพ็กเกจอีกครั้ง');
const mismatch = () => billingError('BILLING_DEAL_SNAPSHOT_MISMATCH', 'ข้อเสนอพิเศษเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่');

/** PostgreSQL JSONB may reorder keys, so the pinned hash is order-insensitive by construction. */
export function dealSnapshotHash(offerSnapshotJson: unknown): string {
  return configurationHash(offerSnapshotJson);
}

/**
 * The deal as an offer (S35). `intervalCount` is the whole point: N months are sold, charged and
 * appended once, so `appendPackageInterval` keeps the anchor day instead of walking short months.
 */
export function dealOffer(snapshot: SalesDealSnapshot): BillingOffer {
  const preset = PLAN_TIER_PRESETS[snapshot.base];
  return {
    offerKey: snapshot.base, interval: 'month', intervalCount: snapshot.months,
    label: `${preset.labelTh} · ข้อเสนอพิเศษ`, priceSatang: snapshot.priceSatang, currency: 'THB',
    branchLimit: snapshot.branchLimit, employeeLimit: snapshot.employeeLimit, monthlySlipLimit: snapshot.monthlySlipLimit,
    receiptAllowance: snapshot.monthlySlipLimit * snapshot.months, receiptAllowanceCadence: 'PAID_PERIOD',
    availability: 'AVAILABLE', reason: null,
  };
}

/** The stored offer, re-validated by the same rules that froze it — a row is not trusted input. */
export function dealSnapshot(offerSnapshotJson: unknown): SalesDealSnapshot {
  const raw = offerSnapshotJson as (SalesDealSnapshot & Record<string, unknown>) | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 2) throw mismatch();
  try { return buildDealSnapshot(raw); } catch (error) {
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
  if (pinned && (pinned.requestId !== row.id || pinned.salesUserId !== row.salesUserId || pinned.months !== snapshot.months ||
      pinned.aiMonthlyBudgetSatang !== snapshot.aiMonthlyBudgetSatang ||
      pinned.snapshotHash !== dealSnapshotHash(row.offerSnapshotJson))) throw mismatch();
  return snapshot;
}

/** The pinned offer must still be exactly what this deal sells (price, months, limits, label). */
export function assertDealOfferUnchanged(snapshot: SalesDealSnapshot, pinnedOffer: BillingOffer): void {
  if (configurationHash(dealOffer(snapshot)) !== configurationHash(pinnedOffer)) throw mismatch();
}

/**
 * S39 — the deal card computes its OWN payment modes. `availablePurchaseModes` answers the
 * catalog and is filtered by the account's current renewal family; a deal is only ever sold on
 * the one-time family, and a shop with a live subscription is refused at quote instead.
 *
 * S38/D-P3-7: Stripe's PromptPay documentation states no per-transaction maximum for THB
 * (https://docs.stripe.com/payments/promptpay, read 2026-09-21 — it lists presentment currency,
 * refunds and disputes, no amount ceiling). The limit a customer actually meets is their own bank
 * app's transfer limit, which we cannot see, so no cap is encoded here. If Stripe ever publishes
 * one, hide PROMPTPAY_ONCE above it in this function.
 */
export function dealPurchaseModes(gates: Partial<Record<BillingAction, boolean>>): BillingPurchaseMode[] {
  if (!gates.new_sales) return [];
  return ([['CARD_ONCE', 'card_once'], ['PROMPTPAY_ONCE', 'promptpay_once']] as const)
    .filter(([, gate]) => gates[gate] === true).map(([mode]) => mode);
}
