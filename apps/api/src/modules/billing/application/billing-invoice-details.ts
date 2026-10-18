import { PLAN_TIER_PRESETS, shopPlanTierLabel, type PlanTierKey, type BillingInvoiceItem, type BillingAdjustmentItem, type BillingAdjustmentKind } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingInvoice, Prisma } from '../../../generated/prisma/client';
import { billingError } from '../domain/billing-policy';
import { safeStripeUrl, stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import { assertMappedCharge } from './billing-financial';

const mismatch = () => billingError('BILLING_DOCUMENT_BINDING', 'กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
/** The one place the provider's id shapes are named: a card charge is ch_ and its refund re_; a PromptPay charge is py_ and its refund pyr_. */
export const chargeIdPrefix = '(?:ch|py)', refundIdPrefix = '(?:re|pyr)';
const idPattern = new RegExp(`^(?:${refundIdPrefix}|cn)_[A-Za-z0-9_]{1,120}$`);
export function sameInvoiceSource(account: BillingAccount, row: BillingInvoice, currentAccount: BillingAccount, current: BillingInvoice) {
  const source = (a: BillingAccount, i: BillingInvoice) => JSON.stringify([a.id,a.companyId,a.customerId,a.stripeAccountId,a.livemode,
    i.id,i.billingAccountId,i.providerInvoiceId,i.providerChargeId,i.subscriptionId,i.totalSatang,i.paidSatang]);
  if (source(account,row) !== source(currentAccount,current)) throw mismatch();
}
export async function originalInvoice(stripe: StripeClient, account: BillingAccount, row: BillingInvoice) {
  if (!account.customerId || account.stripeAccountId !== stripe.accountId || account.livemode !== stripe.livemode || row.billingAccountId !== account.id) throw mismatch();
  await stripe.assertAccount();
  const invoice = await stripe.request('GET', `/invoices/${row.providerInvoiceId}`);
  if (invoice.id !== row.providerInvoiceId || invoice.livemode !== account.livemode || stripeId(invoice.customer) !== account.customerId ||
    stripeId(invoice.parent?.subscription_details?.subscription) !== row.subscriptionId || invoice.currency !== 'thb' ||
    invoice.status !== 'paid' || invoice.total !== row.totalSatang || invoice.amount_paid !== row.paidSatang) throw mismatch();
  return invoice;
}
export function adjustment(value: StripeObject, kind: BillingAdjustmentKind, account: BillingAccount, row: BillingInvoice): BillingAdjustmentItem {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !idPattern.test(value.id) || value.currency !== 'thb' ||
    !Number.isSafeInteger(value.amount) || value.amount <= 0 || value.amount > row.totalSatang ||
    !Number.isSafeInteger(value.created) || value.created <= 0 || value.created > Math.floor(Date.now()/1000)+60) throw mismatch();
  if (kind === 'refunds') {
    if (value.id.startsWith('cn_') || value.object !== 'refund' || stripeId(value.charge) !== row.providerChargeId ||
      value.amount > row.paidSatang || (value.customer != null && stripeId(value.customer) !== account.customerId) ||
      (value.livemode !== undefined && value.livemode !== account.livemode) ||
      (value.status != null && !['pending','requires_action','succeeded','failed','canceled'].includes(value.status))) throw mismatch();
  } else if (!value.id.startsWith('cn_') || value.object !== 'credit_note' || value.livemode !== account.livemode ||
    stripeId(value.invoice) !== row.providerInvoiceId || stripeId(value.customer) !== account.customerId ||
    !['issued','void'].includes(value.status) || typeof value.number !== 'string' || value.number.length > 200) throw mismatch();
  return { id:value.id, number:kind==='credit-notes'?value.number:null, amountSatang:value.amount,
    createdAt:new Date(value.created*1000).toISOString(), status:value.status??'unknown' };
}
export async function readInvoiceAdjustments(stripe: StripeClient, account: BillingAccount, row: BillingInvoice, kind: BillingAdjustmentKind, cursor?: string) {
  const invoice = await originalInvoice(stripe,account,row);
  if (kind === 'refunds') {
    if (!row.providerChargeId) throw billingError('BILLING_DOCUMENT_PENDING','กำลังตรวจหลักฐานการชำระเงิน กรุณาลองใหม่');
    assertMappedCharge(await stripe.request('GET',`/charges/${row.providerChargeId}`),account,row);
  }
  const path=kind==='refunds'?'/refunds':'/credit_notes';
  if (cursor) {
    if (!idPattern.test(cursor)) throw mismatch();
    const anchor=await stripe.request('GET',`${path}/${cursor}`);
    if (adjustment(anchor,kind,account,row).id !== cursor) throw mismatch();
  }
  const page=await stripe.request('GET',path,{[kind==='refunds'?'charge':'invoice']:kind==='refunds'?row.providerChargeId:row.providerInvoiceId,
    limit:25,...cursor?{starting_after:cursor}:{}});
  if (page.object!=='list'||!Array.isArray(page.data)||page.data.length>25||typeof page.has_more!=='boolean'||(page.has_more&&page.data.length===0)) throw mismatch();
  const items=page.data.map((value:StripeObject)=>adjustment(value,kind,account,row));
  if (new Set(items.map(i=>i.id)).size!==items.length||items.some(i=>i.id===cursor)) throw mismatch();
  const paidAt = invoice.status_transitions?.paid_at;
  return {paidAt: Number.isSafeInteger(paidAt) && paidAt > 0 && paidAt <= Math.floor(Date.now()/1000) ? new Date(paidAt*1000).toISOString() : null,
    invoiceId:row.id,invoiceNumber:row.providerNumber,kind,mode:account.livemode?'LIVE' as const:'TEST' as const,items,
    nextCursor:page.has_more?items.at(-1)!.id:null,observedAt:new Date().toISOString()};
}
export async function readInvoiceDocument(stripe: StripeClient, account: BillingAccount, row: BillingInvoice,
  kind: 'invoice'|'receipt'|'pdf'|'credit-note', creditNoteId?: string) {
  const invoice=await originalInvoice(stripe,account,row);
  let value=kind==='pdf'?invoice.invoice_pdf:invoice.hosted_invoice_url;
  if (kind==='receipt') {
    if (!row.providerChargeId) throw billingError('BILLING_DOCUMENT_PENDING','กำลังเตรียมใบเสร็จ กรุณาลองใหม่');
    const charge=await stripe.request('GET',`/charges/${row.providerChargeId}`);
    assertMappedCharge(charge,account,row);value=charge.receipt_url;
  } else if (kind==='credit-note') {
    if (!creditNoteId || !idPattern.test(creditNoteId)) throw mismatch();
    const note=await stripe.request('GET',`/credit_notes/${creditNoteId}`);
    if (adjustment(note,'credit-notes',account,row).id!==creditNoteId) throw mismatch();
    value=note.pdf;
  }
  const url=safeStripeUrl(value,'document');
  if (!url) throw billingError('BILLING_DOCUMENT_PENDING','กำลังเตรียมเอกสาร กรุณาลองใหม่');
  return {url};
}

/** Customer history and a single payment read use the same stored facts; missing evidence stays unknown. */
export function invoiceHistoryItem(row: BillingInvoice, attemptSnapshot: Prisma.JsonValue | null): BillingInvoiceItem {
  const offer = row.offerSnapshot as { offerKey?: string; interval?: string; label?: string } | null;
  const key = offer?.offerKey;
  const interval = offer?.interval;
  const label = key && (row.productKind ?? 'PACKAGE') === 'PACKAGE' && Object.hasOwn(PLAN_TIER_PRESETS, key)
    ? shopPlanTierLabel(key as PlanTierKey) : null;
  const mode = (attemptSnapshot as { quote?: { purchaseMode?: string } } | null)?.quote?.purchaseMode;
  const accepted = row.benefitEnd ? (row.contractSnapshot as { promotion?: { displayName: string; bonusReceiptUnits: number } } | null)?.promotion : null;
  return { id: row.id, number: row.providerNumber, currency: 'THB', amountSatang: row.totalSatang,
    offer: key && label && (interval === 'month' || interval === 'year') ? { key, label, interval } : null,
    method: mode === 'CARD_AUTO' || mode === 'CARD_ONCE' ? 'CARD' : mode === 'PROMPTPAY_ONCE' || mode === 'PROMPTPAY_RENEW' ? 'PROMPTPAY' : null,
    refundedSatang: row.refundedSatang, disputed: row.disputed, financialObservedAt: row.financialObservedAt?.toISOString() ?? null,
    paymentState: row.providerStatus, applyState: row.applyStatus, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
    createdAt: row.createdAt.toISOString(), hasDocuments: row.providerStatus === 'paid',
    ...(accepted ? { promotion: { displayName: accepted.displayName, paidEnd: row.periodEnd.toISOString(), benefitEnd: row.benefitEnd!.toISOString(), bonusReceiptUnits: accepted.bonusReceiptUnits } } : {}) };
}
