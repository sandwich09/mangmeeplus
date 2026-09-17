import { BILLING_PAID_TIERS, billingOffer, type BillingOffer, type BillingPolicy } from '@watchdog-bms/contracts';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import { billingError, hashBilling, quoteTotals } from '../domain/billing-policy';
import { proratedPackagePrice, proratedReceiptIncrease } from '../domain/billing-package';
import type { StripeClient, StripeObject } from '../infrastructure/stripe.client';
import type { BillingSnapshot } from './billing.service';

export type UpgradeSegment = { grantId: string; invoiceId: string; start: string; end: string; oldOffer: BillingOffer;
  newOffer?: BillingOffer; amountSatang: number; receiptUnitsAdded: number };
export type UpgradeSource = { prorationAt: string; sourceHash: string; segments: UpgradeSegment[]; amountSatang: number;
  receiptUnitsAdded: number; previewId: string; previewHash: string };
const review = () => billingError('BILLING_UPGRADE_REVIEW', 'ข้อมูลส่วนต่างแพ็กเกจต้องตรวจสอบ กรุณาติดต่อทีมงานหรือกลับไปดูสถานะสมาชิก');
export function isUpgrade(old: BillingOffer, next: BillingOffer) {
  return old.interval === next.interval && BILLING_PAID_TIERS.indexOf(next.offerKey as typeof BILLING_PAID_TIERS[number]) >
    BILLING_PAID_TIERS.indexOf(old.offerKey as typeof BILLING_PAID_TIERS[number]);
}

/** Only persisted verified invoices establish credit; consumption is intentionally outside this source hash. */
export async function upgradeHistory(db: Prisma.TransactionClient, account: BillingAccount, offer: BillingOffer,
  policy: BillingPolicy, prorationAt: string) {
  const at = new Date(prorationAt);
  if (!Number.isSafeInteger(at.getTime()) || !account.paidThrough || at >= account.paidThrough) throw review();
  const grants = await db.billingReceiptGrant.findMany({ where: { billingAccountId: account.id, companyId: account.companyId,
    serviceEnd: { gt: at }, revokedAt: null }, orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  const invoices = await db.billingInvoice.findMany({ where: { billingAccountId: account.id, id: { in: grants.map(g => g.sourceKey) } } });
  const base = grants.filter(g => ['INITIAL', 'RENEWAL', 'REPEAT'].includes(g.kind)).sort((a,b) => a.serviceStart.getTime() - b.serviceStart.getTime());
  const upgrades = grants.filter(g => g.kind === 'UPGRADE');
  const invoiceFor = (grant: typeof grants[number]) => {
    const invoice = invoices.find(i => i.id === grant.sourceKey);
    if (!invoice || !invoice.appliedAt || invoice.applyStatus !== 'APPLIED' || invoice.providerStatus !== 'paid' || invoice.paidSatang <= 0 ||
      invoice.paidSatang !== invoice.totalSatang || invoice.refundedSatang || invoice.disputed || !invoice.contractSnapshot || !invoice.evidenceHash ||
      invoice.periodStart.getTime() !== grant.serviceStart.getTime() || invoice.periodEnd.getTime() !== grant.serviceEnd.getTime() ||
      grant.availableAt > at || grant.expiresAt < account.paidThrough!) throw review();
    return invoice;
  };
  const giftRows = await db.billingOperation.findMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
    livemode: account.livemode, type: 'GRANT_FREE_DAYS', state: 'SUCCEEDED' }, select: { id: true, proposedJson: true } });
  const gifts = giftRows.map(row => {
    const p = row.proposedJson as unknown as { accountId: string; dayExtension: { days: number; before: string; after: string } };
    const start = Date.parse(p.dayExtension?.before), end = Date.parse(p.dayExtension?.after);
    if (p.accountId !== account.id || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(p.dayExtension.days) ||
      p.dayExtension.days < 1 || end - start !== p.dayExtension.days * 86400000) throw review();
    return { id: row.id, start, end };
  }).filter(gift => gift.end > at.getTime()).sort((a, b) => a.start - b.start);
  const skipFree = (from: number, until: number) => {
    let cursor = from;
    for (const gift of gifts) if (gift.start <= cursor && gift.end > cursor) cursor = Math.min(until, gift.end);
    return cursor;
  };
  let cursor = at.getTime();
  const segments: UpgradeSegment[] = base.map(grant => {
    const invoice = invoiceFor(grant), original = invoice.contractSnapshot as unknown as BillingSnapshot;
    cursor = skipFree(cursor, Math.max(at.getTime(), grant.serviceStart.getTime()));
    if (grant.units !== original.quote.offer.receiptAllowance || Math.max(at.getTime(), grant.serviceStart.getTime()) !== cursor ||
      grant.serviceEnd <= grant.serviceStart || grant.serviceEnd > account.paidThrough!) throw review();
    cursor = grant.serviceEnd.getTime();
    let accepted = original, acceptedOffer = original.quote.offer;
    for (const delta of upgrades) {
      const changed = invoiceFor(delta).contractSnapshot as unknown as BillingSnapshot;
      const oldSegment = changed.upgrade?.segments.find(s => s.grantId === grant.id);
      if (!oldSegment) continue;
      const nextOffer = oldSegment.newOffer ?? changed.quote.offer;
      if (oldSegment.start !== grant.serviceStart.toISOString() || oldSegment.end !== grant.serviceEnd.toISOString() ||
        hashBilling(oldSegment.oldOffer) !== hashBilling(acceptedOffer) || !isUpgrade(acceptedOffer, nextOffer) || nextOffer.offerKey !== changed.quote.offer.offerKey ||
        changed.upgrade?.receiptUnitsAdded !== delta.units) throw review();
      accepted = changed;
      acceptedOffer = nextOffer;
    }
    // Purchased monthly and annual segments retain their own prices/allowances after a cadence change.
    const targetOffer = acceptedOffer.interval === offer.interval ? offer : billingOffer(offer.offerKey, acceptedOffer.interval, policy);
    if (!isUpgrade(acceptedOffer, targetOffer) || accepted.policy.taxTreatment !== policy.taxTreatment) throw review();
    return { grantId: grant.id, invoiceId: invoice.id, start: grant.serviceStart.toISOString(), end: grant.serviceEnd.toISOString(),
      oldOffer: acceptedOffer, ...(acceptedOffer.interval !== offer.interval ? { newOffer: targetOffer } : {}), amountSatang: proratedPackagePrice(acceptedOffer.priceSatang, targetOffer.priceSatang, grant.serviceStart, grant.serviceEnd, at),
      receiptUnitsAdded: proratedReceiptIncrease([{ start: grant.serviceStart, end: grant.serviceEnd,
        oldAllowance: acceptedOffer.receiptAllowance, newAllowance: targetOffer.receiptAllowance }], at) };
  });
  cursor = skipFree(cursor, account.paidThrough.getTime());
  if (!segments.length && gifts.length && cursor === account.paidThrough.getTime()) throw billingError('BILLING_UPGRADE_GIFT_ONLY', 'เวลาที่เหลือเป็นวันแถม ซื้อแพ็กเกจเดิมเพิ่มก่อน แล้วจึงเปลี่ยนเป็นแพ็กเกจที่สูงขึ้น');
  if (!segments.length || cursor !== account.paidThrough.getTime() || new Set(segments.map(s => s.oldOffer.offerKey)).size !== 1) throw review();
  const amountSatang = segments.reduce((sum,s) => sum+s.amountSatang,0), receiptUnitsAdded = segments.reduce((sum,s) => sum+s.receiptUnitsAdded,0);
  if (!Number.isSafeInteger(amountSatang) || amountSatang < 1000 || !Number.isSafeInteger(receiptUnitsAdded) || receiptUnitsAdded > 2147483647) throw review();
  return { prorationAt, segments, amountSatang, receiptUnitsAdded, sourceHash: hashBilling([account.id, account.baseSubscriptionId,
    account.paidThrough, gifts, segments, grants.map(g => [g.id,g.sourceHash,g.revokedAt]), invoices.sort((a,b)=>a.id.localeCompare(b.id)).map(i => [i.id,i.evidenceHash,i.refundedSatang,i.disputed])]) };
}

export async function upgradePreview(stripe: StripeClient, amount: number, policy: BillingPolicy) {
  const preview = await stripe.request('POST', '/invoices/create_preview', { currency: 'thb', customer_details: { address: { country: 'TH' } },
    discounts: '', invoice_items: [{ amount, currency: 'thb', description: 'Mangmee prepaid package upgrade', discountable: false,
      tax_behavior: policy.taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive', ...(policy.taxRateId ? { tax_rates: [policy.taxRateId] } : {}) }] });
  const totals = quoteTotals(amount, policy.taxTreatment), line = preview.lines?.data?.[0];
  const taxes = Array.isArray(preview.total_taxes) ? preview.total_taxes.reduce((sum: number,t: StripeObject)=>sum+t.amount,0) : 0;
  if (typeof preview.id !== 'string' || preview.object !== 'invoice' || preview.livemode !== stripe.livemode || preview.currency !== 'thb' ||
    preview.parent !== null || preview.total !== totals.totalSatang || preview.amount_due !== totals.totalSatang || preview.amount_paid !== 0 ||
    preview.starting_balance !== 0 || (preview.ending_balance ?? 0) !== 0 || preview.amount_shipping !== 0 || taxes !== totals.taxSatang ||
    (preview.discounts?.length ?? 0) || (preview.total_discount_amounts?.length ?? 0) || (preview.total_pretax_credit_amounts?.length ?? 0) ||
    (preview.pre_payment_credit_notes_amount ?? 0) || preview.lines?.has_more !== false || preview.lines.data.length !== 1 ||
    line.amount !== amount || line.currency !== 'thb' || line.quantity !== 1 || line.discountable !== false ||
    line.parent?.type !== 'invoice_item_details' || (line.parent?.subscription_item_details != null) ||
    (line.discount_amounts?.length ?? 0) || (line.pretax_credit_amounts?.length ?? 0)) throw review();
  return { ...totals, previewId: preview.id, previewHash: hashBilling(preview) };
}
