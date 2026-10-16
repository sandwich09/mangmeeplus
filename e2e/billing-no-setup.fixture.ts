/**
 * Purchase without setup (pr-d §5.3): a locked shop with no account email and no address buys a
 * package. Billing, the plan-term notice and Stripe Checkout are simulated here; the session, the
 * company and every other read stay real (the seeded company). Not a spec file, so Playwright never
 * runs it by itself.
 */
import type { Page } from '@playwright/test';
import { BILLING_PAID_TIERS, billingOffer, type BillingAttemptView, type BillingCatalog, type BillingEmailRecipient,
  type BillingEmailRecipientOperation, type BillingInvoiceItem, type BillingOffer, type BillingPurchaseMode, type BillingQuote,
  type BillingStatus } from '@watchdog-bms/contracts';
import { WEB_BASE_URL } from './harness/auth';

export type Stage = 'locked' | 'checkout' | 'paid' | 'applied' | 'failed' | 'unknown';
export type NoSetupState = {
  stage: Stage; cancelResult: 'EXPIRED' | 'COMPLETED' | 'PENDING'; quoteTtlMs: number; checkoutResult: 'open' | 'FAILED' | 'UNKNOWN';
  recipientEmail: string; resendsLeft: number;
  log: { quotes: Record<string, unknown>[]; checkouts: string[]; checkoutBodies: Record<string, unknown>[]; cancels: number; otp: string[]; resends: number; attempts: number };
};
export const ATTEMPT = '11111111-1111-4111-8111-111111111111', INVOICE = '22222222-2222-4222-8222-222222222222';
const CHALLENGE = '33333333-3333-4333-8333-333333333333', PROOF = '44444444-4444-4444-8444-444444444444', OPERATION = '55555555-5555-4555-8555-555555555555';
const MODES: BillingPurchaseMode[] = ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'];
const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const days = (n: number) => at(n * 86_400_000);

export function defaultState(): NoSetupState {
  return { stage: 'locked', cancelResult: 'EXPIRED', quoteTtlMs: 600_000, checkoutResult: 'open', recipientEmail: 'buyer@example.test', resendsLeft: 2,
    log: { quotes: [], checkouts: [], checkoutBodies: [], cancels: 0, otp: [], resends: 0, attempts: 0 } };
}

const PROFILE = { name: 'ร้านใหม่ไม่มีอีเมล', nameSource: 'SHOP' as const, missingFields: ['line1', 'subdistrict', 'district', 'province', 'postalCode'] as ('line1' | 'subdistrict' | 'district' | 'province' | 'postalCode')[],
  address: { line1: '', line2: null, subdistrict: '', district: '', province: '', postalCode: '' } };

export function noSetupStatus(companyId: string, s: NoSetupState): BillingStatus {
  const applied = s.stage === 'applied', paid = applied || s.stage === 'paid';
  const mode = (s.log.quotes.at(-1)?.purchaseMode as BillingPurchaseMode | undefined) ?? 'CARD_AUTO';
  const renewing = mode === 'CARD_AUTO' || mode === 'PROMPTPAY_RENEW';
  const units = billingOffer('STARTER_249', 'month').receiptAllowance;
  return {
    companyId, companyName: 'ร้านใหม่ไม่มีอีเมล', mode: 'TEST', policyRevision: 'policy-nosetup', billingProfile: PROFILE,
    paymentState: s.stage === 'locked' ? 'NONE' : s.stage === 'checkout' ? 'PENDING' : s.stage === 'failed' ? 'FAILED' : s.stage === 'unknown' ? 'UNKNOWN' : 'PAID',
    applyState: applied ? 'APPLIED' : s.stage === 'paid' ? 'PENDING' : 'NONE',
    purchaseEligibility: 'ELIGIBLE', purchaseSource: 'TRIAL', renewalMode: applied ? mode : 'NONE',
    enabledPurchaseModes: MODES, availablePurchaseModes: MODES,
    accessState: applied ? 'ACTIVE' : 'EXPIRED', ...(applied ? {} : { lockReason: 'no_package' as const }),
    subscriptionState: applied && renewing ? 'active' : 'NONE', documentState: 'NONE',
    attemptId: s.stage === 'locked' ? null : ATTEMPT, reference: null, observedAt: null,
    canCancelCheckout: s.stage === 'checkout' || s.stage === 'unknown',
    tierKey: applied ? 'STARTER_249' : 'FREE_TRIAL_15', interval: applied ? 'month' : null,
    termEndsAt: applied ? days(30) : days(0), paidThrough: applied ? days(30) : null, nextChargeAt: applied && renewing ? days(30) : null,
    cancelAtPeriodEnd: false, graceEndsAt: null,
    allowedActions: applied ? ['new_sales', 'portal_cancel_subscription', 'plan_changes', 'portal_payment_method'] : s.stage === 'locked' || s.stage === 'failed' ? ['new_sales'] : [],
    usage: applied ? { used: 0, limit: units, remaining: units, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: days(30) }
      : { used: 0, limit: 15, remaining: 15, cadence: 'LEGACY_MONTH', resetsAt: days(30), expiresAt: null },
    issues: [],
    // PR C writes the recipient when the payment applies: between PAID and APPLIED it is still empty.
    ...(paid ? { recipient: { email: applied ? s.recipientEmail : null, source: applied ? 'STRIPE_CHECKOUT' as const : null, bouncedAt: null, canChange: applied } } : {}),
    checkoutAddress: applied ? { line1: '99 ถนนทดสอบ', line2: null, subdistrict: '', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } : null,
  };
}

export function noSetupNotice(s: NoSetupState) {
  const applied = s.stage === 'applied';
  return { derivedState: applied ? 'ACTIVE' : 'EXPIRED', termEndsAt: applied ? days(30) : days(0), daysLeft: applied ? 30 : 0,
    isOwner: true, canManagePlan: true, ...(applied ? {} : { lockReason: 'no_package' }) };
}

const offers = (): BillingOffer[] => BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => ({ ...billingOffer(tier, interval), availability: 'AVAILABLE' as const, reason: null })));
const catalog = (): BillingCatalog => ({ schemaVersion: 1, mode: 'TEST', policyRevision: 'policy-nosetup', catalogRevision: 'catalog-nosetup',
  generatedAt: at(), validUntil: at(3_600_000), taxTreatment: 'NOT_VAT_REGISTERED', offers: offers(), aiMonthlyBudgetSatang: 80_000 });
const invoice = (): BillingInvoiceItem => ({ id: INVOICE, number: 'NOSETUP-0001', currency: 'THB', amountSatang: 24900, refundedSatang: 0, disputed: false,
  financialObservedAt: at(), paymentState: 'PAID', applyState: 'APPLIED', periodStart: at(), periodEnd: days(30), createdAt: at(), hasDocuments: true,
  documentActions: { canResend: true } });
const attempt = (s: NoSetupState): BillingAttemptView => ({ attemptId: ATTEMPT, state: s.stage === 'locked' ? 'EXPIRED' : 'OPEN', errorCode: null, observedAt: at(),
  paymentState: s.stage === 'paid' || s.stage === 'applied' ? 'PAID' : s.stage === 'failed' || s.stage === 'locked' ? 'FAILED' : 'PENDING',
  applyState: s.stage === 'applied' ? 'APPLIED' : s.stage === 'paid' ? 'PENDING' : 'NONE', invoiceReference: s.stage === 'applied' ? 'NOSETUP-0001' : null });

export async function installNoSetupRoutes(page: Page, companyId: string, s: NoSetupState): Promise<void> {
  const base = `/api/v1/companies/${encodeURIComponent(companyId)}/billing`;
  const returnUrl = `${WEB_BASE_URL.replace(/\/$/, '')}/companies/${encodeURIComponent(companyId)}/billing/return?attempt=${ATTEMPT}`;
  let operation: BillingEmailRecipientOperation | null = null;
  // A stand-in for Stripe's own page: pay, or come back without paying (cancel_url carries checkout=canceled).
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><h1>Stripe (จำลอง)</h1><a id="pay" href="${returnUrl}">จ่ายจำลอง</a> <a id="back" href="${returnUrl}&checkout=canceled">กลับโดยไม่จ่าย</a></body></html>` }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (method === 'GET') {
      if (path === '/api/v1/plan-term/notice') return json(noSetupNotice(s));
      if (path === '/api/v1/billing/catalog') return json(catalog());
      if (path === base) return json(noSetupStatus(companyId, s));
      if (path === `${base}/history`) return json({ items: s.stage === 'applied' ? [invoice()] : [], nextCursor: null });
      if (path === `${base}/attempts/${ATTEMPT}`) { s.log.attempts++; return json(attempt(s)); }
      if (path === `${base}/recipient`) {
        const recipient: BillingEmailRecipient = s.stage === 'paid' || s.stage === 'applied'
          ? { email: s.recipientEmail, hasCustomer: true, operation: null, busy: false } : { email: null, hasCustomer: false, operation: null };
        return json(recipient);
      }
    }
    if (method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      if (path === `${base}/quote`) {
        s.log.quotes.push(body);
        const offer = offers().find(item => item.offerKey === body.offerKey && item.interval === body.interval)!;
        const quote: BillingQuote = { quoteId: `q-${s.log.quotes.length}`, companyId, companyName: 'ร้านใหม่ไม่มีอีเมล', policyRevision: 'policy-nosetup',
          expiresAt: at(s.quoteTtlMs), purchaseMode: (body.purchaseMode as BillingPurchaseMode | undefined) ?? 'CARD_AUTO', offer,
          subtotalSatang: offer.priceSatang, taxSatang: 0, totalSatang: offer.priceSatang, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'billing-v2',
          paidStart: 'IMMEDIATE', billingEmail: null, trialEndsAt: null, usage: noSetupStatus(companyId, s).usage, billingProfile: PROFILE,
          previousSource: 'NO_TERM', previousTermEndsAt: null,
          purchase: { kind: 'INITIAL', previousPaidThrough: null, projectedPaidThrough: days(offer.interval === 'year' ? 365 : 30), receiptUnitsAdded: offer.receiptAllowance, projectedRemainingReceipts: offer.receiptAllowance } };
        return json(quote);
      }
      if (path === `${base}/checkout`) {
        s.log.checkouts.push(request.headers()['idempotency-key'] ?? '');
        s.log.checkoutBodies.push(body);
        if (s.checkoutResult === 'FAILED') return json({ attemptId: ATTEMPT, state: 'FAILED', checkoutUrl: null });
        if (s.checkoutResult === 'UNKNOWN') { s.stage = 'unknown'; return json({ attemptId: ATTEMPT, state: 'UNKNOWN', checkoutUrl: null }); }
        s.stage = 'checkout';
        return json({ attemptId: ATTEMPT, state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_nosetup' });
      }
      if (path === `${base}/attempts/${ATTEMPT}/cancel`) {
        s.log.cancels++;
        if (s.cancelResult === 'EXPIRED') s.stage = 'locked';
        if (s.cancelResult === 'COMPLETED') s.stage = 'paid';
        return json({ state: s.cancelResult });
      }
      if (path === `${base}/refresh`) return json({ queued: true }, 202);
      if (path === `${base}/recipient/otp/request`) {
        s.log.otp.push(String(body.email));
        return json({ challengeId: CHALLENGE, email: body.email, expiresAt: at(600_000), retryAt: at(60_000), attemptsRemaining: 5, deliveryStatus: 'ACCEPTED', delivered: true }, 202);
      }
      if (path === `${base}/recipient/otp/confirm`) return body.code === '123456'
        ? json({ recipientProofId: PROOF, email: s.log.otp.at(-1), expiresAt: at(600_000) })
        : json({ code: 'EMAIL_OTP_INVALID', message: 'invalid' }, 409);
      if (path === `${base}/recipient/preview`) {
        operation = { id: OPERATION, state: 'PREVIEW', version: 1, previewHash: 'nosetup-hash', expiresAt: at(600_000), previousEmail: s.recipientEmail,
          newEmail: s.log.otp.at(-1) ?? s.recipientEmail, canSubmit: true, canCancel: true, source: 'CUSTOMER_OTP' };
        return json(operation);
      }
      if (path === `${base}/recipient/${OPERATION}/submit` && operation) {
        operation = { ...operation, state: 'COMPLETED', version: 2, canSubmit: false, canCancel: false };
        s.recipientEmail = operation.newEmail;
        return json(operation);
      }
      if (path === `${base}/documents/${INVOICE}/resend`) {
        s.log.resends++;
        return s.resendsLeft > 0 ? json({ invoiceSent: true, receiptUpdated: true, recipientEmail: s.recipientEmail, remainingToday: --s.resendsLeft })
          : json({ code: 'BILLING_RESEND_LIMIT', message: 'limit', retryAfterSeconds: 3600 }, 429);
      }
    }
    return route.continue();
  });
}
