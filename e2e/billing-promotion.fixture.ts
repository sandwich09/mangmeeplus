/**
 * Promotion screens in a real browser (lane FXE). Billing (customer package page) and the Admin campaign API are SIMULATED with
 * `page.route` on top of the real seeded session and company; every answer is typed with the contract types, so a drift in the
 * wire shapes fails a typecheck. The shapes follow what the API really sends: `billing.service.ts` status()/quote(),
 * `domain/billing-promotion.ts` promotionUnavailable(), `application/billing-promotion-campaigns.ts` and the campaign methods of
 * `billing-configuration.service.ts`. Not a spec file, so Playwright never runs it by itself.
 */
import type { Page, Route } from '@playwright/test';
import { BILLING_PAID_TIERS, BILLING_PROMOTION_STARTER_TEMPLATE, billingOffer, type BillingAttemptView, type BillingCatalog, type BillingConfigurationOperation,
  type BillingEventDiscountView, type BillingInterval, type BillingInvoiceItem, type BillingOffer, type BillingPromotionCampaign, type BillingPromotionCampaignDetail,
  type BillingPromotionCampaignDraft, type BillingPromotionCampaignList, type BillingPromotionCampaignReport, type BillingPromotionCampaignView, type BillingPromotionDraftError,
  type BillingPromotionOfferView, type BillingPromotionPreviewRow, type BillingPromotionReportCompany, type BillingPromotionUnavailableReason, type BillingPromotionUse,
  type BillingPurchaseMode, type BillingPurchaseSource, type BillingQuote, type BillingStatus, type PaidTier } from '@watchdog-bms/contracts';
import { WEB_BASE_URL } from './harness/auth';

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* time: every browser in these specs runs on this fixed clock (12:00 in Bangkok), so the Thai dates on screen never move            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export const FIXED_NOW = '2026-10-09T05:00:00.000Z';
const NOW_MS = Date.parse(FIXED_NOW);
export const iso = (ms: number) => new Date(ms).toISOString();
export const inMs = (ms: number) => iso(NOW_MS + ms);
export const inDays = (days: number) => inMs(days * 86_400_000);
/** `appendPackageInterval`: months are counted once from the start and clamped to the month end (never 30/365 days). */
export function addMonths(value: string, months: number): string {
  const start = new Date(value), end = new Date(start);
  end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + months);
  end.setUTCDate(Math.min(start.getUTCDate(), new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()));
  return end.toISOString();
}
const ADMIN_DATE = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });
const ADMIN_TIME = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
/** What an Admin screen prints for an instant (`formatThaiDateTime`): "9 ต.ค. 2569 12:00 น." */
export const thaiDateTime = (value: string) => `${ADMIN_DATE.format(new Date(value))} ${ADMIN_TIME.format(new Date(value))} น.`;
/** What the page prints for a date: Thai, Buddhist year, Bangkok. */
export const thaiDay = (value: string) => new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* customer package page                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export const CAMPAIGN_ID = 'camp-starter-oct';
export const CAMPAIGN_NAME = 'โปรแถมเดือน Starter';
/** 31 Oct 23:59 Bangkok. */
export const CAMPAIGN_ENDS_AT = '2026-10-31T16:59:00.000Z';
export const MODES: BillingPurchaseMode[] = ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'];
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111', INVOICE_ID = '22222222-2222-4222-8222-222222222222';
export { ATTEMPT_ID, INVOICE_ID };

export type QuoteBody = { offerKey: PaidTier; interval: BillingInterval; purchaseMode?: BillingPurchaseMode; benefitChoice?: string; promotionCampaignId?: string;
  eventDiscountChoice?: string; eventDiscountTicketSerial?: string; billingEmail?: string; [key: string]: unknown };
export type CheckoutCall = { body: Record<string, unknown>; key: string };
type Answer = { status: number; json: unknown };

export type CustomerWorld = {
  companyId: string;
  /** The shop as the API reports it. Tests change it between reads. */
  status: BillingStatus;
  /** INITIAL = a shop with nothing to run on (first purchase); REPEAT = a one-time Starter that is still running. */
  purchase: 'INITIAL' | 'REPEAT';
  /** What the shop ran on before this purchase (`quote.previousSource`): NO_TERM for a new shop, TRIAL for a legacy trial. */
  source: BillingPurchaseSource;
  /** Receipts a legacy trial hands over to the first package (`quote.purchase.trialCarryover`); 0 = none. */
  trialCarryoverUnits: number;
  history: BillingInvoiceItem[];
  attempt: BillingAttemptView | null;
  /** `GET …/event-discount`: what the holder's own tickets say. */
  heldDiscount: BillingEventDiscountView;
  /** Quote answers by order of the request (1-based); anything not listed is answered by the default simulation. */
  quoteOverride: (n: number, body: QuoteBody) => Answer | undefined;
  checkoutOverride: (n: number) => Answer | undefined;
  /** `POST …/attempts/:id/resume` ("ชำระเงินต่อ"): the Checkout URL of the open payment, or what the API refuses with. */
  resumeOverride: (n: number) => Answer | undefined;
  /** `POST …/attempts/:id/cancel` ("ยกเลิกรายการนี้ …"): what the API refuses with. A cancel that goes through answers `cancelState`. */
  cancelOverride: (n: number) => Answer | undefined;
  cancelState: 'EXPIRED' | 'COMPLETED' | 'PENDING';
  /** Holds back every status read that comes after an open payment was ended (the read the page makes next), so a test can look at the screen while the answer is still on its way. null = answered at once. */
  statusHold: Promise<void> | null;
  /** The shop once its open payment is ended (EXPIRED): the same shop with no attempt, the reserved right given back and the promotion on offer again. null = unchanged. */
  afterCancel: BillingStatus | null;
  /** Every POST the page sent to the billing API, in order (path relative to `…/billing`). */
  log: { quotes: QuoteBody[]; checkouts: CheckoutCall[]; statusReads: number; refreshes: number; resumes: number; cancels: number; calls: SentCall[]; others: string[] };
};
export type SentCall = { method: string; path: string; body: unknown; key: string | null };

export const offers = (): BillingOffer[] => BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval =>
  ({ ...billingOffer(tier, interval), availability: 'AVAILABLE' as const, reason: null })));
export const offerFor = (offerKey: string, interval: string) => offers().find(item => item.offerKey === offerKey && item.interval === interval)!;

/** Starter month and year as a campaign window shows them to a shop. `reason` set = visible but not takeable. */
export function promotionRows(reason: BillingPromotionUnavailableReason | null = null, over: Partial<BillingPromotionOfferView> = {}): BillingPromotionOfferView[] {
  return (['month', 'year'] as const).map(interval => ({ campaignId: CAMPAIGN_ID, displayName: CAMPAIGN_NAME, offerKey: 'STARTER_249' as const, interval,
    bonusMonths: 1, bonusReceiptUnits: 30, totalMonths: interval === 'year' ? 13 : 2, totalReceiptUnits: interval === 'year' ? 390 : 60,
    endsAt: CAMPAIGN_ENDS_AT, available: reason === null, reason, ...over }));
}

const PROFILE_NEW = { name: 'ร้านกาแฟตัวอย่าง', nameSource: 'SHOP' as const, missingFields: ['line1', 'subdistrict', 'district', 'province', 'postalCode'] as ('line1' | 'subdistrict' | 'district' | 'province' | 'postalCode')[],
  address: { line1: '', line2: null, subdistrict: '', district: '', province: '', postalCode: '' } };
const PROFILE_FULL = { name: 'ร้านกาแฟตัวอย่าง', nameSource: 'SHOP' as const, missingFields: [] as never[],
  address: { line1: '99 ถนนทดสอบ', line2: null, subdistrict: 'คลองตัน', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } };

/** A shop that has nothing to run on yet (locked, "ยังไม่มีแพ็กเกจ"): the main audience of the promotion. */
export function newShopStatus(companyId: string, over: Partial<BillingStatus> = {}): BillingStatus {
  return { companyId, companyName: 'ร้านกาแฟตัวอย่าง', mode: 'TEST', policyRevision: 'policy-promo', billingProfile: PROFILE_NEW,
    paymentState: 'NONE', applyState: 'NONE', purchaseEligibility: 'ELIGIBLE', purchaseSource: 'NO_TERM', renewalMode: 'NONE',
    enabledPurchaseModes: MODES, availablePurchaseModes: MODES, accessState: 'EXPIRED', lockReason: 'no_package', subscriptionState: 'NONE', documentState: 'NONE',
    attemptId: null, reference: null, observedAt: null, tierKey: null, interval: null, termEndsAt: null, paidThrough: null, nextChargeAt: null,
    cancelAtPeriodEnd: false, graceEndsAt: null, allowedActions: ['new_sales'], packageChangesEnabled: true,
    usage: { used: 0, limit: 0, remaining: 0, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: null }, issues: [], promotions: promotionRows(), ...over };
}

/** A shop that paid for Starter: active, `paidThrough` and `termEndsAt` as the API reports them (the end of the FREE time when it has some). */
export function paidShopStatus(companyId: string, over: Partial<BillingStatus> = {}): BillingStatus {
  const end = addMonths(FIXED_NOW, 2);
  return { ...newShopStatus(companyId), billingProfile: PROFILE_FULL, paymentState: 'PAID', applyState: 'APPLIED', purchaseSource: 'PAID_CURRENT_MODE', renewalMode: 'CARD_AUTO',
    accessState: 'ACTIVE', lockReason: undefined, subscriptionState: 'active', attemptId: null, reference: INVOICE_ID, tierKey: 'STARTER_249', interval: 'month',
    termEndsAt: end, paidThrough: end, nextChargeAt: end, allowedActions: ['new_sales', 'portal_cancel_subscription', 'portal_payment_method'], promotions: undefined,
    usage: { used: 0, limit: 60, remaining: 60, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: end }, ...over };
}

export function promotionUse(over: Partial<BillingPromotionUse> = {}): BillingPromotionUse {
  const paidEnd = addMonths(FIXED_NOW, 1), benefitEnd = addMonths(FIXED_NOW, 2);
  return { campaignId: CAMPAIGN_ID, displayName: CAMPAIGN_NAME, state: 'CONSUMED', paidEnd, benefitEnd, bonusMonths: 1, bonusReceiptUnits: 30,
    renewalSetupState: 'READY', expectedNextChargeAt: benefitEnd, ...over };
}

/**
 * A card auto-renew shop right after a successful promotion purchase, as the live API reported it on UAT (2026-10-10): active, paid, applied, the promotion CONSUMED with its free time still ahead.
 * `new_sales` is not allowed while that time runs, so the API says why with `purchaseBlockCode` BILLING_REPEAT_NOT_READY and `upgradeDeferredUntil` (= the promotion's benefit end); only the card
 * actions are left. The page shows this as one quiet line inside the package card, not as an alert.
 */
export function deferredShopStatus(companyId: string, over: Partial<BillingStatus> = {}): BillingStatus {
  const use = promotionUse();
  return paidShopStatus(companyId, { promotion: use, upgradeDeferredUntil: addMonths(FIXED_NOW, 2), purchaseBlockCode: 'BILLING_REPEAT_NOT_READY',
    allowedActions: ['portal_payment_method', 'portal_cancel_subscription'], availablePurchaseModes: ['CARD_AUTO'], ...over });
}
/** The same moment for a shop that pays a QR bill every period (PROMPTPAY_RENEW): the API answers BILLING_PLAN_CHANGE_REQUIRED and no `new_sales`; nothing is charged by itself. */
export function qrShopStatus(companyId: string, over: Partial<BillingStatus> = {}): BillingStatus {
  return deferredShopStatus(companyId, { renewalMode: 'PROMPTPAY_RENEW', purchaseBlockCode: 'BILLING_PLAN_CHANGE_REQUIRED', allowedActions: [], availablePurchaseModes: ['PROMPTPAY_RENEW'], ...over });
}

/** One held sales-event discount (50 baht off every card), as `status.eventDiscount` carries it. */
export function heldTicket(): NonNullable<BillingStatus['eventDiscount']> {
  const serial = 'K7M2Q9XA', eventName = 'งานสัมมนาร้านค้า', expiresAt = '2026-12-31T16:59:00.000Z';
  const cards = BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => ({ offerKey: tier, interval, shownDiscountSatang: 5000 })));
  return { ticketSerial: serial, eventName, discountSatang: 5000, expiresAt, reason: null, offers: cards.map(card => ({ ...card, eventName })),
    tickets: [{ ticketSerial: serial, eventName, discountSatang: 5000, expiresAt, offers: cards }] };
}
/** The holder's own view of that ticket (`GET …/event-discount`): DISCOUNT = the discount box on the package page. */
export const heldTicketView = (): BillingEventDiscountView => ({ path: 'DISCOUNT', tickets: [{ serial: 'K7M2Q9XA', eventName: 'งานสัมมนาร้านค้า', discountSatang: 5000,
  chatCreditUnits: 0, receiptImageUnits: 0, expiresAt: '2026-12-31T16:59:00.000Z', state: 'AVAILABLE', batchSuspended: false }] });
/**
 * `status()` while a Checkout of the shop is open (`account.activeAttemptId` set). `free` is the same shop with no payment open.
 * What the API does then (billing.service.ts status()): `new_sales`, `plan_changes` and `portal_cancel_subscription` all need `!activeAttemptId`, so only `portal_payment_method`
 * can be left; `promotions` and `eventDiscount` are computed only where `new_sales` is allowed, so a status in this state carries neither (the shop's `promotion` right is not gated: a reserved or running one stays); `purchaseBlockCode` is
 * BILLING_CHECKOUT_PENDING; `attemptId` and `reference` name the attempt (no invoice of its own yet); `canCancelCheckout` is true while the Checkout session can still be ended.
 */
export function openPaymentStatus(free: BillingStatus, over: Partial<BillingStatus> = {}): BillingStatus {
  const open: BillingStatus = { ...free, paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true, purchaseBlockCode: 'BILLING_CHECKOUT_PENDING',
    allowedActions: free.allowedActions.filter(action => action === 'portal_payment_method'), ...over };
  if (!('promotions' in over)) delete open.promotions;
  if (!('eventDiscount' in over)) delete open.eventDiscount;
  return open;
}

/** A legacy trial that is still running: it buys through INITIAL, and the page tells how long the new package runs. */
export const trialShopStatus = (companyId: string, over: Partial<BillingStatus> = {}) => newShopStatus(companyId, { accessState: 'ACTIVE', lockReason: undefined, purchaseSource: 'TRIAL',
  tierKey: 'FREE_TRIAL_15', termEndsAt: inDays(20), usage: { used: 3, limit: 15, remaining: 12, cadence: 'LEGACY_MONTH', resetsAt: inDays(20), expiresAt: null }, ...over });

export function defaultCustomerWorld(companyId: string, status: BillingStatus = newShopStatus(companyId)): CustomerWorld {
  return { companyId, status, purchase: 'INITIAL', source: 'NO_TERM', trialCarryoverUnits: 0, history: [], attempt: null, heldDiscount: { path: null, tickets: [] },
    quoteOverride: () => undefined, checkoutOverride: () => undefined, resumeOverride: () => undefined, cancelOverride: () => undefined, cancelState: 'EXPIRED', statusHold: null, afterCancel: null,
    log: { quotes: [], checkouts: [], statusReads: 0, refreshes: 0, resumes: 0, cancels: 0, calls: [], others: [] } };
}

/** The 409 the API raises (`promotionUnavailable`): `{ code, reason, message }`, the message in the API's own words. */
const API_TEXT: Record<BillingPromotionUnavailableReason, string> = {
  NOT_STARTED: 'โปรโมชั่นนี้ยังไม่เริ่ม', ENDED: 'โปรโมชั่นนี้สิ้นสุดแล้ว', PAUSED: 'โปรโมชั่นนี้พักรับสิทธิ์ชั่วคราว', CAP_FULL: 'สิทธิ์โปรโมชั่นนี้เต็มแล้ว',
  ALREADY_USED: 'ร้านนี้ใช้สิทธิ์โปรโมชั่นนี้แล้ว', IN_PROGRESS: 'ร้านนี้มีรายการชำระเงินที่ใช้สิทธิ์โปรโมชั่นนี้ค้างอยู่',
  CATALOG_STALE: 'เงื่อนไขแพ็กเกจเปลี่ยน โปรโมชั่นนี้จึงยังใช้ไม่ได้', OFFER_NOT_COVERED: 'แพ็กเกจนี้ไม่อยู่ในโปรโมชั่น',
  PURCHASE_KIND_UNSUPPORTED: 'รายการซื้อแบบนี้ยังใช้สิทธิ์โปรโมชั่นไม่ได้', CHANGED: 'เงื่อนไขโปรโมชั่นเปลี่ยน กรุณาตรวจสอบรายการใหม่',
};
export const promotionUnavailableAnswer = (reason: BillingPromotionUnavailableReason): Answer =>
  ({ status: 409, json: { code: 'PROMOTION_UNAVAILABLE', reason, message: API_TEXT[reason] } });
export const apiMessage = (reason: BillingPromotionUnavailableReason) => API_TEXT[reason];

/** The quote the API would send. Same rules as `quote()`: a PROMOTION quote needs an available row for the card, or it is a 409 with the reason. */
export function answerQuote(w: CustomerWorld, body: QuoteBody, n: number): Answer {
  const forced = w.quoteOverride(n, body);
  if (forced) return forced;
  const offer = offerFor(body.offerKey, body.interval), mode = body.purchaseMode ?? 'CARD_AUTO', oneTime = mode === 'CARD_ONCE' || mode === 'PROMPTPAY_ONCE';
  const repeat = w.purchase === 'REPEAT', previous = repeat ? w.status.paidThrough! : null;
  const start = repeat ? previous! : FIXED_NOW, paidEnd = addMonths(start, offer.interval === 'year' ? 12 : 1);
  const quote: BillingQuote = {
    quoteId: `quote-${n}`, companyId: w.companyId, companyName: w.status.companyName, policyRevision: 'policy-promo', expiresAt: inMs(600_000), purchaseMode: mode, offer,
    subtotalSatang: offer.priceSatang, taxSatang: 0, totalSatang: offer.priceSatang, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'billing-v2',
    paidStart: 'IMMEDIATE', billingEmail: null, trialEndsAt: w.source === 'TRIAL' ? w.status.termEndsAt : null, usage: w.status.usage, billingProfile: w.status.billingProfile,
    previousSource: repeat ? 'PAID_CURRENT_MODE' : w.source, previousTermEndsAt: repeat ? previous : w.source === 'TRIAL' ? w.status.termEndsAt : null,
    purchase: { kind: repeat ? 'REPEAT' : 'INITIAL', ...(repeat ? { previousInterval: w.status.interval ?? 'month' } : {}), previousPaidThrough: previous, projectedPaidThrough: paidEnd,
      receiptUnitsAdded: offer.receiptAllowance, projectedRemainingReceipts: (repeat ? w.status.usage.remaining ?? 0 : 0) + offer.receiptAllowance },
  };
  if (!repeat && w.source === 'TRIAL' && w.trialCarryoverUnits > 0) {
    quote.purchase!.trialCarryover = { receiptUnits: w.trialCarryoverUnits, expiresAt: paidEnd };
    quote.purchase!.projectedRemainingReceipts += w.trialCarryoverUnits;
  }
  if (body.benefitChoice === 'PROMOTION') {
    const row = (w.status.promotions ?? []).find(item => item.campaignId === body.promotionCampaignId && item.offerKey === body.offerKey && item.interval === body.interval);
    if (!row) return promotionUnavailableAnswer('CHANGED');
    if (!row.available) return promotionUnavailableAnswer(row.reason ?? 'CHANGED');
    if (repeat && !oneTime) return promotionUnavailableAnswer('PURCHASE_KIND_UNSUPPORTED');
    const benefitEnd = addMonths(start, (offer.interval === 'year' ? 12 : 1) + row.bonusMonths);
    quote.promotion = { campaignId: row.campaignId, displayName: row.displayName, bonusMonths: row.bonusMonths, bonusReceiptUnits: row.bonusReceiptUnits,
      totalReceiptUnits: offer.receiptAllowance + row.bonusReceiptUnits, paidStart: start, paidEnd, benefitEnd, expectedNextChargeAt: oneTime ? null : benefitEnd };
  }
  // Sales-event discount (one benefit per purchase): the real quote attaches it whenever a held ticket fits this card.
  const ticket = w.status.eventDiscount, fit = ticket && !ticket.reason ? ticket.offers.find(item => item.offerKey === body.offerKey && item.interval === body.interval) : undefined;
  if (ticket && fit) {
    const choice = body.benefitChoice ? body.benefitChoice === 'EVENT_DISCOUNT' ? 'USE' : 'DECLINE' : (body.eventDiscountChoice as 'USE' | 'DECLINE' | undefined) ?? 'USE';
    const total = offer.priceSatang - fit.shownDiscountSatang;
    quote.eventDiscount = { choice, ticketSerial: ticket.ticketSerial, eventName: ticket.eventName, expiresAt: ticket.expiresAt, discountSatang: ticket.discountSatang,
      shownDiscountSatang: fit.shownDiscountSatang, ...(choice === 'USE' ? { applied: { unitAmountSatang: total, subtotalSatang: total, taxSatang: 0, totalSatang: total } } : {}) };
  }
  if (body.benefitChoice) quote.benefitChoice = body.benefitChoice as NonNullable<BillingQuote['benefitChoice']>;
  return { status: 200, json: quote };
}

export function catalog(): BillingCatalog {
  return { schemaVersion: 1, mode: 'TEST', policyRevision: 'policy-promo', catalogRevision: 'catalog-promo', generatedAt: FIXED_NOW, validUntil: inDays(1),
    taxTreatment: 'NOT_VAT_REGISTERED', offers: offers(), aiMonthlyBudgetSatang: 80_000 };
}

/** What a locked shop and an active shop read from `GET /plan-term/notice`, so the shell around the page is the real one for that state. */
function planNotice(w: CustomerWorld) {
  const active = w.status.accessState === 'ACTIVE';
  return { derivedState: active ? 'ACTIVE' : 'EXPIRED', termEndsAt: active ? w.status.termEndsAt : inDays(0), daysLeft: active ? 60 : 0, isOwner: true, canManagePlan: true,
    ...(active ? {} : { lockReason: w.status.lockReason ?? 'no_package' }) };
}

export function invoiceItem(over: Partial<BillingInvoiceItem> = {}): BillingInvoiceItem {
  return { id: INVOICE_ID, number: 'PROMO-0001', currency: 'THB', amountSatang: 24900, refundedSatang: 0, disputed: false, financialObservedAt: FIXED_NOW,
    paymentState: 'PAID', applyState: 'APPLIED', periodStart: FIXED_NOW, periodEnd: addMonths(FIXED_NOW, 1), createdAt: FIXED_NOW, hasDocuments: true, documentActions: { canResend: true }, ...over };
}

/** Routes for the customer package page. Everything not listed here (menus, branches, notifications …) stays real. */
export async function installCustomerRoutes(page: Page, w: CustomerWorld): Promise<void> {
  const base = `/api/v1/companies/${encodeURIComponent(w.companyId)}/billing`;
  const returnUrl = `${WEB_BASE_URL.replace(/\/$/, '')}/companies/${encodeURIComponent(w.companyId)}/billing/return?attempt=${ATTEMPT_ID}`;
  // A stand-in for Stripe's own page, so a confirmed checkout has somewhere to go.
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><h1>Stripe (จำลอง)</h1><a id="pay" href="${returnUrl}">จ่ายจำลอง</a></body></html>` }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (method === 'GET') {
      if (path === '/api/v1/plan-term/notice') return json(planNotice(w));
      if (path === '/api/v1/billing/catalog') return json(catalog());
      if (path === base) { w.log.statusReads++; if (w.statusHold && w.log.cancels > 0) await w.statusHold; return json(w.status); }
      if (path === `${base}/history`) return json({ items: w.history, nextCursor: null });
      if (path === `${base}/event-discount`) return json(w.heldDiscount);
      if (path === `${base}/recipient`) return json({ email: null, hasCustomer: false, operation: null });
      if (path === `${base}/attempts/${ATTEMPT_ID}`) return w.attempt ? json(w.attempt) : json({ message: 'not found' }, 404);
    }
    if (method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      w.log.calls.push({ method, path: path.slice(base.length), body, key: request.headers()['idempotency-key'] ?? null });
      if (path === `${base}/quote`) {
        w.log.quotes.push(body as QuoteBody);
        const answer = answerQuote(w, body as QuoteBody, w.log.quotes.length);
        return json(answer.json, answer.status);
      }
      if (path === `${base}/checkout`) {
        w.log.checkouts.push({ body, key: request.headers()['idempotency-key'] ?? '' });
        const forced = w.checkoutOverride(w.log.checkouts.length);
        if (forced) return json(forced.json, forced.status);
        return json({ attemptId: ATTEMPT_ID, state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_promo' });
      }
      if (path === `${base}/refresh`) { w.log.refreshes++; return json({ queued: true }, 202); }
      if (path === `${base}/attempts/${ATTEMPT_ID}/cancel`) {
        w.log.cancels++;
        const forced = w.cancelOverride(w.log.cancels);
        if (forced) return json(forced.json, forced.status);
        if (w.cancelState === 'EXPIRED' && w.afterCancel) w.status = w.afterCancel;
        return json({ state: w.cancelState });
      }
      if (path === `${base}/attempts/${ATTEMPT_ID}/resume`) {
        w.log.resumes++;
        const forced = w.resumeOverride(w.log.resumes);
        return forced ? json(forced.json, forced.status) : json({ attemptId: ATTEMPT_ID, state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_promo' });
      }
    }
    return route.continue();
  });
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Admin campaign API                                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export const PERM_MANAGE = 'system.billing.policy.manage';
export const READ_ONLY = ['system.billing.read'];
export const MANAGER = ['system.billing.read', PERM_MANAGE, 'system.billing.financial.read'];

export type DraftValues = Omit<BillingPromotionCampaignDraft, 'campaignId'>;
type CampaignRecord = {
  campaignId: string; createdAt: string;
  published: BillingPromotionCampaign | null;
  draft: { operationId: string; version: number; values: BillingPromotionCampaignDraft } | null;
  operation: BillingConfigurationOperation | null;
  usage: { reserved: number; consumed: number };
  /** The state a window has when the published terms are CATALOG_STALE (the server compares offer signatures; the test sets this). */
  stale?: boolean;
  report?: BillingPromotionCampaignReport[];
};
export type AdminCall = { method: string; path: string; body: unknown; key: string | null };
type Fault = { status: number; body: unknown };

export type AdminWorld = {
  mode: 'TEST' | 'LIVE' | 'DISABLED';
  settingsVersion: number;
  capabilities: string[];
  reauthUntil: string | null;
  campaigns: CampaignRecord[];
  calls: AdminCall[];
  /** A failure to answer with, keyed `METHOD tail` (e.g. `POST promotion-campaign-drafts`, `GET promotion-campaigns`); consumed once unless `sticky`. */
  faults: Map<string, Fault & { sticky?: boolean }>;
  /** Stable blocker codes the server puts on a preview row (e.g. the catalog moved under a published rule), by cycle. */
  blockers: Partial<Record<BillingInterval, string[]>>;
  nextId: number;
};

export function newAdminWorld(over: Partial<Pick<AdminWorld, 'mode' | 'capabilities' | 'reauthUntil'>> = {}): AdminWorld {
  return { mode: 'TEST', settingsVersion: 7, capabilities: MANAGER, reauthUntil: null, campaigns: [], calls: [], faults: new Map(), blockers: {}, nextId: 1, ...over };
}

export const STARTER_RULES = BILLING_PROMOTION_STARTER_TEMPLATE.rules.map(rule => ({ offerKey: 'STARTER_249' as const, interval: rule.interval, bonusMonths: rule.bonusMonths, bonusReceiptUnits: rule.bonusReceiptUnits }));
const SIGNATURE: Record<string, string> = { 'STARTER_249:month': 'a'.repeat(64), 'STARTER_249:year': 'b'.repeat(64) };

export function publishedCampaign(over: Partial<BillingPromotionCampaign> = {}): BillingPromotionCampaign {
  return { campaignId: CAMPAIGN_ID, type: 'BONUS_MONTHS', revision: 1, internalName: 'Starter แถมเดือน ต.ค. 2569', description: 'โปรเปิดตัวสำหรับร้านใหม่',
    displayName: CAMPAIGN_NAME, rules: STARTER_RULES.map(rule => ({ ...rule, offerSignature: SIGNATURE[`${rule.offerKey}:${rule.interval}`]! })),
    startsAt: '2026-10-01T03:00:00.000Z', endsAt: CAMPAIGN_ENDS_AT, cap: 100, paused: false, endedAt: null, ...over };
}

let operationCounter = 0;
export function openOperation(over: Partial<BillingConfigurationOperation> & Pick<BillingConfigurationOperation, 'state' | 'allowedActions'>): BillingConfigurationOperation {
  operationCounter++;
  return { id: `00000000-0000-4000-8000-${String(operationCounter).padStart(12, '0')}`, type: 'PUBLISH_POLICY', scope: { kind: 'PLATFORM', mode: 'TEST' }, version: 1, reason: 'เปิดโปรเดือนตุลาคม',
    initiatorUserId: 'user-admin', approverUserId: null, approvalMode: 'SINGLE_ADMIN', errorCode: null, createdAt: FIXED_NOW, observedAt: null, expiresAt: inMs(600_000), referenceId: null,
    sourceVersion: 7, previewHash: 'h'.repeat(64), proposed: { policy: {} as BillingConfigurationOperation['proposed']['policy'], gates: {} as BillingConfigurationOperation['proposed']['gates'] },
    impact: null, activeRevisionId: null, ...over };
}

export function addCampaign(w: AdminWorld, over: Partial<CampaignRecord> = {}): CampaignRecord {
  const id = over.campaignId ?? `camp-${w.nextId++}`;
  const record: CampaignRecord = { campaignId: id, createdAt: inDays(-w.campaigns.length - 1), published: null, draft: null, operation: null, usage: { reserved: 0, consumed: 0 }, ...over };
  w.campaigns.push(record);
  return record;
}

/** The terms-only draft of a complete campaign: what a saved, complete draft holds. */
export function completeDraft(campaignId: string, over: Partial<BillingPromotionCampaignDraft> = {}): BillingPromotionCampaignDraft {
  return { campaignId, type: 'BONUS_MONTHS', internalName: 'Starter แถมเดือน พ.ย. 2569', description: null, displayName: 'โปรแถมเดือน Starter',
    rules: STARTER_RULES, startsAt: '2026-11-01T03:00:00.000Z', endsAt: '2026-11-30T16:59:00.000Z', cap: 200, ...over };
}

/** Missing/invalid fields exactly as the API lists them (`parsePromotionDraft`). */
export function draftErrors(values: BillingPromotionCampaignDraft): BillingPromotionDraftError[] {
  const errors: BillingPromotionDraftError[] = [];
  if (!values.internalName) errors.push({ field: 'internalName', code: 'REQUIRED' });
  if (!values.displayName) errors.push({ field: 'displayName', code: 'REQUIRED' });
  if (!values.rules?.length) errors.push({ field: 'rules', code: 'REQUIRED' });
  if (!values.startsAt) errors.push({ field: 'startsAt', code: 'REQUIRED' });
  if (!values.endsAt) errors.push({ field: 'endsAt', code: 'REQUIRED' });
  else if (values.startsAt && values.endsAt <= values.startsAt) errors.push({ field: 'endsAt', code: 'END_NOT_AFTER_START' });
  if (values.cap === undefined) errors.push({ field: 'cap', code: 'REQUIRED' });
  return errors;
}

function statusOf(w: AdminWorld, record: CampaignRecord): BillingPromotionCampaignView['status'] {
  const published = record.published;
  if (!published) return record.operation?.state === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL' : 'DRAFT';
  if (published.endedAt !== null || NOW_MS >= Date.parse(published.endsAt)) return 'ENDED';
  if (record.stale) return 'CATALOG_STALE';
  if (published.paused) return 'PAUSED';
  return NOW_MS < Date.parse(published.startsAt) ? 'SCHEDULED' : 'ACTIVE';
}

function viewOf(w: AdminWorld, record: CampaignRecord): BillingPromotionCampaignView {
  const manage = w.capabilities.includes(PERM_MANAGE), published = record.published, ended = !!published && statusOf(w, record) === 'ENDED';
  const draft = record.draft ? { ...record.draft, validationErrors: draftErrors(record.draft.values) } : null;
  const allowed: BillingPromotionCampaignView['allowedActions'] = [];
  if (manage) {
    if (!ended) allowed.push('EDIT');
    if (draft) allowed.push('DISCARD_DRAFT');
    if (draft && !ended && !draft.validationErrors.length) allowed.push('PREVIEW');
  }
  for (const step of record.operation?.allowedActions ?? []) if (step === 'submit') allowed.push('SUBMIT'); else if (step === 'approve') allowed.push('APPROVE'); else if (step === 'cancel') allowed.push('CANCEL');
  if (manage && published && !ended) { allowed.push(published.paused ? 'RESUME' : 'PAUSE'); allowed.push('END'); }
  return { campaignId: record.campaignId, status: statusOf(w, record), published, draft, pendingOperationId: record.operation?.id ?? null,
    usage: { ...record.usage, taken: record.usage.reserved + record.usage.consumed, cap: published?.cap ?? null }, pendingCheckouts: record.usage.reserved, allowedActions: allowed };
}

/** The server computes these from the catalog; the numbers are the template's at the default Starter price. */
export function previewRowsFor(values: { rules?: DraftValues['rules'] }, blockers: Partial<Record<BillingInterval, string[]>> = {}): BillingPromotionPreviewRow[] {
  return (values.rules ?? []).map(rule => {
    const year = rule.interval === 'year', price = year ? 249000 : 24900, base = year ? 360 : 30, paidMonths = year ? 12 : 1;
    return { offerKey: rule.offerKey, interval: rule.interval, offerSignature: SIGNATURE[`${rule.offerKey}:${rule.interval}`]!, priceSatang: price, subtotalSatang: price, taxSatang: 0,
      totalSatang: price, paidMonths, bonusMonths: rule.bonusMonths, totalMonths: paidMonths + rule.bonusMonths, baseReceiptUnits: base, bonusReceiptUnits: rule.bonusReceiptUnits,
      totalReceiptUnits: base + rule.bonusReceiptUnits, exampleStartsAt: FIXED_NOW, paidEnd: addMonths(FIXED_NOW, paidMonths), benefitEnd: addMonths(FIXED_NOW, paidMonths + rule.bonusMonths),
      renewalTotalSatang: price, blockers: blockers[rule.interval] ?? [] };
  });
}

function detailOf(w: AdminWorld, record: CampaignRecord): BillingPromotionCampaignDetail {
  const view = viewOf(w, record), source = view.draft?.values.rules?.length ? view.draft.values : view.published ? view.published : null;
  return { mode: w.mode, settingsVersion: w.settingsVersion, capabilities: w.capabilities, reauthenticatedUntil: w.reauthUntil, campaign: view, operation: record.operation,
    previewRows: source ? previewRowsFor(source, w.blockers) : [] };
}

/** An API error body, the way Nest sends it: `{ code, message }`. */
export const apiError = (status: number, code: string, message = code): Fault => ({ status, body: { statusCode: status, code, message } });

/** What the permission guard answers (`deny-by-default.guard.ts`): no `code`, the message the web client already knows. */
export const forbidden = (): Fault => ({ status: 403, body: { statusCode: 403, message: 'Insufficient permissions.', error: 'Forbidden' } });

export function failNext(w: AdminWorld, key: string, fault: Fault, sticky = false) { w.faults.set(key, { ...fault, sticky }); }

/** One reporting page per cursor: `report[0]` is the first page, `nextCursor` of page i is `p${i + 1}`. */
export function reportPage(over: Partial<BillingPromotionCampaignReport> = {}): BillingPromotionCampaignReport {
  return { campaignId: CAMPAIGN_ID, mode: 'TEST', generatedAt: FIXED_NOW, counts: { reserved: 2, paidAwaitingApply: 1, applied: 12, releasedBeforePay: 3, refunded: 1, fullyRefunded: 1, rightsActive: 11 },
    bonusMonthsGranted: 12, bonusReceiptUnitsGranted: 360, moneyReceivedSatang: 321_300, refundedSatang: 24_900, companies: [], nextCursor: null, ...over };
}
export function reportCompany(i: number, over: Partial<BillingPromotionReportCompany> = {}): BillingPromotionReportCompany {
  return { companyId: `company-${i}`, companyName: `ร้านทดสอบหมายเลข ${i}`, state: 'CONSUMED', offerKey: 'STARTER_249', interval: i % 2 ? 'year' : 'month', acceptedAt: inDays(-i),
    consumedAt: inDays(-i), benefitAppliedAt: inDays(-i), releasedAt: null, paidEnd: addMonths(inDays(-i), i % 2 ? 12 : 1), benefitEnd: addMonths(inDays(-i), i % 2 ? 13 : 2), refund: 'NONE',
    entitlementAdjustmentState: 'NOT_REQUIRED', attemptHref: `/system/billing/companies/company-${i}/checkouts/att-${i}`, invoiceHref: `/system/billing/companies/company-${i}/invoices/inv-${i}`, ...over };
}

/** Routes for the Admin campaign screens. Everything else under /system stays real. */
export async function installAdminRoutes(page: Page, w: AdminWorld): Promise<void> {
  const prefix = '/api/v1/system/billing/';
  await page.route('**/api/v1/system/billing/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), tail = url.pathname.slice(prefix.length);
    const isCampaign = /^(promotion-campaigns|promotion-campaign-drafts|reauthenticate|configuration-changes\/)/.test(tail);
    if (!isCampaign) return route.continue();
    const body = method === 'POST' ? request.postDataJSON() : undefined, key = request.headers()['idempotency-key'] ?? null;
    w.calls.push({ method, path: tail + url.search, body, key });
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    const faultKey = `${method} ${tail.replace(/^promotion-campaigns\/[^/]+/, 'promotion-campaigns/:id').replace(/^promotion-campaign-drafts\/[^/]+/, 'promotion-campaign-drafts/:id').replace(/^configuration-changes\/[^/]+/, 'configuration-changes/:id')}`;
    const fault = w.faults.get(faultKey);
    if (fault) { if (!fault.sticky) w.faults.delete(faultKey); return json(fault.body, fault.status); }
    return answerAdmin(w, route, method, tail, body as Record<string, unknown> | undefined, key, json);
  });
}

type Json = (value: unknown, status?: number) => Promise<void>;
async function answerAdmin(w: AdminWorld, route: Route, method: string, tail: string, body: Record<string, unknown> | undefined, key: string | null, json: Json): Promise<void> {
  const find = (id: string) => w.campaigns.find(item => item.campaignId === decodeURIComponent(id));
  const list = (): BillingPromotionCampaignList => ({ mode: w.mode, settingsVersion: w.mode === 'DISABLED' ? 0 : w.settingsVersion, capabilities: w.capabilities,
    campaigns: w.mode === 'DISABLED' ? [] : [...w.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => viewOf(w, item)), template: BILLING_PROMOTION_STARTER_TEMPLATE });
  if (method === 'GET' && tail === 'promotion-campaigns') return json(list());
  const one = /^promotion-campaigns\/([^/]+)(?:\/(report|preview|pause|end))?$/.exec(tail);
  if (method === 'GET' && one && !one[2]) {
    const record = find(one[1]!);
    return record ? json(detailOf(w, record)) : json(apiError(404, 'CONTROL_PROMOTION_NOT_FOUND', 'ไม่พบแคมเปญนี้').body, 404);
  }
  if (method === 'GET' && one?.[2] === 'report') {
    const record = find(one[1]!);
    if (!record) return json(apiError(404, 'CONTROL_PROMOTION_NOT_FOUND').body, 404);
    const cursor = new URL(route.request().url()).searchParams.get('cursor'), pages = record.report ?? [reportPage()];
    const index = cursor ? Number(cursor.replace('p', '')) : 0, page = pages[index] ?? pages.at(-1)!;
    const financial = w.capabilities.includes('system.billing.financial.read');
    return json({ ...page, ...(financial ? {} : { moneyReceivedSatang: null, refundedSatang: null }), nextCursor: index + 1 < pages.length ? `p${index + 1}` : null });
  }
  if (method === 'POST' && tail === 'promotion-campaign-drafts') {
    const input = body as { campaignId?: string; draftVersion?: number; values: DraftValues; reason: string };
    let record = input.campaignId ? find(input.campaignId) : undefined;
    if (!record) record = addCampaign(w, { campaignId: input.campaignId ?? `camp-new-${w.nextId++}`, createdAt: FIXED_NOW });
    const start = record.draft?.values ?? (record.published ? { campaignId: record.campaignId, type: record.published.type, internalName: record.published.internalName, description: record.published.description,
      displayName: record.published.displayName, startsAt: record.published.startsAt, endsAt: record.published.endsAt, cap: record.published.cap, rules: STARTER_RULES } : {});
    const values: BillingPromotionCampaignDraft = { ...start, ...input.values, campaignId: record.campaignId };
    record.draft = { operationId: `draft-${record.campaignId}`, version: (record.draft?.version ?? 0) + 1, values };
    return json(detailOf(w, record));
  }
  const discard = /^promotion-campaign-drafts\/([^/]+)\/discard$/.exec(tail);
  if (method === 'POST' && discard) {
    const record = find(discard[1]!);
    if (record) { record.draft = null; if (!record.published) w.campaigns.splice(w.campaigns.indexOf(record), 1); }
    return json(list());
  }
  if (method === 'POST' && one?.[2] === 'preview') {
    const record = find(one[1]!);
    if (!record) return json(apiError(404, 'CONTROL_PROMOTION_NOT_FOUND').body, 404);
    const input = body as { action: 'PUBLISH' | 'RESUME' };
    const source = input.action === 'RESUME' ? record.published : record.draft?.values;
    record.operation = openOperation({ state: 'PREVIEW', allowedActions: ['submit', 'cancel'], reason: String(body?.reason ?? ''), referenceId: record.draft?.operationId ?? null,
      sourceVersion: Number(body?.expectedVersion ?? w.settingsVersion) });
    return json({ operation: record.operation, previewRows: previewRowsFor(source ?? {}) });
  }
  if (method === 'POST' && (one?.[2] === 'pause' || one?.[2] === 'end')) {
    const record = find(one[1]!);
    if (!record?.published) return json(apiError(404, 'CONTROL_PROMOTION_NOT_FOUND').body, 404);
    if (w.reauthUntil === null || Date.parse(w.reauthUntil) <= NOW_MS) return json(apiError(403, 'CONTROL_REAUTH_REQUIRED').body, 403);
    if (one[2] === 'pause') record.published = { ...record.published, paused: true }; else record.published = { ...record.published, endedAt: FIXED_NOW };
    w.settingsVersion++;
    void key;
    return json(detailOf(w, record));
  }
  if (method === 'POST' && tail === 'reauthenticate') {
    if ((body as { password?: string } | undefined)?.password !== 'correct-password') return json({ code: 'CONTROL_REAUTH_FAILED', message: 'รหัสผ่านไม่ถูกต้อง' }, 403);
    w.reauthUntil = inMs(300_000);
    return json({ reauthenticatedUntil: w.reauthUntil });
  }
  const step = /^configuration-changes\/([^/]+)\/(submit|approve|cancel)$/.exec(tail);
  if (method === 'POST' && step) {
    const record = w.campaigns.find(item => item.operation?.id === decodeURIComponent(step[1]!));
    if (!record?.operation) return json(apiError(404, 'CONTROL_PROMOTION_NOT_FOUND').body, 404);
    if (step[2] !== 'cancel' && (w.reauthUntil === null || Date.parse(w.reauthUntil) <= NOW_MS)) return json(apiError(403, 'CONTROL_REAUTH_REQUIRED').body, 403);
    const operation = record.operation;
    if (step[2] === 'submit') record.operation = { ...operation, state: 'AWAITING_APPROVAL', version: operation.version + 1, allowedActions: ['approve', 'cancel'] };
    else if (step[2] === 'cancel') { record.operation = null; return json({ ...operation, state: 'CANCELLED', version: operation.version + 1, allowedActions: [] }); }
    else {
      // approve: the draft becomes the published terms (the server builds them from the saved draft)
      const values = record.draft?.values;
      if (values) record.published = { ...publishedCampaign({ campaignId: record.campaignId }), internalName: values.internalName!, description: values.description ?? null, displayName: values.displayName!,
        startsAt: values.startsAt!, endsAt: values.endsAt!, cap: values.cap ?? null, paused: false, endedAt: null };
      else if (record.published) record.published = { ...record.published, paused: false };
      record.draft = null; w.settingsVersion++;
      const done = { ...operation, state: 'SUCCEEDED' as const, version: operation.version + 1, allowedActions: [] };
      record.operation = null;
      return json(done);
    }
    return json(record.operation);
  }
  return route.continue();
}
