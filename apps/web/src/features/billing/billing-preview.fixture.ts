import { billingOffer, type BillingCatalog, type BillingStatus, type BillingQuote, type BillingOffer, type BillingCollectionOperation, type BillingEmailRecipientOperation } from '@watchdog-bms/contracts';
import type { billingApi } from './billing.api';

export const previewScenarios = {
  start: 'เลือกแพ็กเกจ', capacity: 'เลือกสาขาและผู้ใช้', upgrade: 'เพิ่ม / ลดแพ็กเกจ', expired: 'หมดอายุ / เริ่มใหม่',
  pending: 'รอผลชำระเงิน', activating: 'จ่ายแล้ว รอเปิดสิทธิ์', success: 'สำเร็จ / ประวัติ', failed: 'ชำระไม่สำเร็จ',
  held: 'รอตรวจสอบ', 'quote-error': 'ราคาเปลี่ยน / ลองใหม่',
} as const;
export type PreviewScenario = keyof typeof previewScenarios;

// In-memory only: every method is supplied here, with no fallback to a live billing API.
export function createBillingPreview(companyId: string, scenario: PreviewScenario, selected: BillingOffer | null, onCheckout: (quote: Pick<BillingQuote, 'offer' | 'totalSatang'>) => void) {
  const date = (days = 0) => new Date(Date.now() + days * 86_400_000).toISOString();
  const currentOffer = selected ?? billingOffer('BASIC_499', 'month');
  const periodDays = currentOffer.interval === 'year' ? 365 : 30;
  const paid = ['success', 'upgrade', 'activating'].includes(scenario);
  const attempted = ['success', 'pending', 'activating', 'failed', 'held'].includes(scenario);
  const offers: BillingOffer[] = (['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const).flatMap(tier => (['month', 'year'] as const).map(interval => ({
    ...billingOffer(tier, interval), availability: tier === 'ENTERPRISE_1999' ? 'COMING_SOON' : 'AVAILABLE', reason: null,
  })));
  const status: BillingStatus = {
    companyId, companyName: 'บริษัทตัวอย่าง · ข้อมูลพรีวิว', mode: 'TEST', policyRevision: 'preview-policy',
    paymentState: paid ? 'PAID' : scenario === 'failed' ? 'FAILED' : attempted ? 'PENDING' : 'NONE',
    applyState: scenario === 'activating' ? 'PENDING' : scenario === 'held' ? 'HELD' : paid ? 'APPLIED' : 'NONE',
    accessState: scenario === 'expired' ? 'EXPIRED' : scenario === 'held' ? 'HELD' : 'ACTIVE',
    purchaseEligibility: 'ELIGIBLE', subscriptionState: paid ? 'active' : 'NONE', documentState: paid ? 'READY' : 'NONE',
    attemptId: attempted ? 'preview-attempt' : null, reference: attempted ? 'PREVIEW-0001' : null, observedAt: date(),
    tierKey: paid ? currentOffer.offerKey : 'FREE_TRIAL_15', interval: paid ? currentOffer.interval : null,
    termEndsAt: date(scenario === 'expired' ? -1 : periodDays), paidThrough: paid ? date(periodDays) : null,
    nextChargeAt: paid ? date(periodDays) : null, cancelAtPeriodEnd: false, graceEndsAt: null,
    allowedActions: attempted && !paid ? [] : paid ? ['new_sales', 'portal_cancel_subscription', 'plan_changes', 'portal_payment_method'] : ['new_sales'],
    usage: { used: 6, limit: paid ? currentOffer.receiptAllowance : 15, remaining: paid ? currentOffer.receiptAllowance - 6 : 9,
      cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: date(periodDays) }, issues: [],
  };
  let quote: BillingQuote | null = null, collection: BillingCollectionOperation | null = null, recipient: BillingEmailRecipientOperation | null = null;
  let quoteFailures = scenario === 'quote-error' ? 1 : 0;
  const catalog = (): BillingCatalog => ({ schemaVersion: 1, mode: 'TEST', policyRevision: 'preview-policy', catalogRevision: 'preview-catalog',
    generatedAt: date(), validUntil: new Date(Date.now() + 60_000).toISOString(), taxTreatment: 'NOT_VAT_REGISTERED', offers,
    trial: { tierKey: 'FREE_TRIAL_15', days: 30, monthlySlipLimit: 15, branchLimit: 1, employeeLimit: 2, menus: 7 } });
  const requiredQuote = () => {
    if (!quote) throw new Error('กรุณาเลือกแพ็กเกจและตรวจยอดก่อน');
    return quote;
  };
  const api: ReturnType<typeof billingApi> = {
    status: async () => ({ ...status }), catalog: async () => catalog(),
    history: async () => ({ items: paid ? [{ id: 'preview-invoice', number: 'PREVIEW-0001', currency: 'THB', amountSatang: currentOffer.priceSatang,
      refundedSatang: 0, disputed: false, financialObservedAt: date(), paymentState: 'PAID', applyState: status.applyState,
      periodStart: date(), periodEnd: date(periodDays), createdAt: date(), hasDocuments: true }] : [], nextCursor: null }),
    attempt: async () => ({ attemptId: 'preview-attempt', state: status.applyState, errorCode: null, observedAt: date(),
      paymentState: status.paymentState === 'PAID' ? 'PAID' : status.paymentState === 'FAILED' ? 'FAILED' : 'PENDING', applyState: status.applyState, invoiceReference: paid ? 'PREVIEW-0001' : null }),
    quote: async (offerKey, interval, billingEmail, capacity) => {
      if (quoteFailures-- > 0) throw Object.assign(new Error('ราคาเปลี่ยนแล้ว'), { code: 'BILLING_QUOTE_STALE' });
      if (scenario === 'capacity' && !capacity) throw Object.assign(new Error('เลือกสิทธิ์ก่อน'), { code: 'BILLING_CAP_SELECTION_REQUIRED' });
      const offer = offers.find(item => item.offerKey === offerKey && item.interval === interval)!;
      const isUpgrade = scenario === 'upgrade' && offer.priceSatang > currentOffer.priceSatang;
      if (scenario === 'upgrade' && offer.priceSatang < currentOffer.priceSatang) throw Object.assign(new Error('กรุณาใช้ส่วนลดแพ็กเกจสิ้นรอบด้านบน'), { code: 'BILLING_PLAN_CHANGE_REQUIRED' });
      quote = { quoteId: 'preview-quote', companyId, companyName: status.companyName, policyRevision: 'preview-policy', expiresAt: date(1),
        offer, subtotalSatang: isUpgrade ? Math.round(offer.priceSatang / 2) : offer.priceSatang, taxSatang: 0,
        totalSatang: isUpgrade ? Math.round(offer.priceSatang / 2) : offer.priceSatang, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'preview-consent',
        paidStart: 'IMMEDIATE', billingEmail, trialEndsAt: date(7), usage: status.usage,
        purchase: { kind: isUpgrade ? 'UPGRADE' : scenario === 'upgrade' ? 'REPEAT' : scenario === 'expired' ? 'RESTART' : 'INITIAL', previousPaidThrough: status.paidThrough,
          projectedPaidThrough: date(interval === 'year' ? 365 : 30), receiptUnitsAdded: offer.receiptAllowance, projectedRemainingReceipts: offer.receiptAllowance },
        ...(isUpgrade ? { upgrade: { prorationAt: date(), nextRenewalTotalSatang: offer.priceSatang,
          segments: [{ start: date(), end: date(15), amountSatang: Math.round(offer.priceSatang / 2), receiptUnitsAdded: Math.round(offer.receiptAllowance / 2) }] } } : {}),
        ...(capacity ? { capacity: { retainedBranches: capacity.branchIds.map(id => id === 'ho' ? 'สำนักงานใหญ่' : 'สาขาตัวอย่าง'), suspendedBranches: ['สาขาที่ไม่เลือก'],
          retainedMembers: ['เจ้าของร้าน', ...capacity.memberships.slice(1).map(() => 'พนักงานตัวอย่าง')], suspendedMembers: ['พนักงานที่ไม่เลือก'], defaults: [] } } : {}),
      };
      return quote;
    },
    capacity: async (offerKey, interval) => {
      const offer = offers.find(item => item.offerKey === offerKey && item.interval === interval)!;
      return { companyId, offerKey, interval: offer.interval, sourceHash: 'preview-capacity', branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit,
        overCapacity: true, branches: Array.from({ length: offer.branchLimit + 1 }, (_, i) => ({ id: i ? `branch-${i}` : 'ho', name: i ? `สาขาตัวอย่าง ${i}` : 'สำนักงานใหญ่', headOffice: !i, required: !i, openReimbursements: 0 })),
        memberships: Array.from({ length: offer.employeeLimit + 1 }, (_, i) => ({ id: i ? `member-${i}` : 'owner', name: i ? `พนักงานตัวอย่าง ${i}` : 'เจ้าของร้าน', owner: !i, required: !i, allBranches: true, branchIds: ['ho'], defaultBranchId: 'ho' })) };
    },
    checkout: async () => { onCheckout(requiredQuote()); return { attemptId: 'preview-attempt', state: 'PENDING', checkoutUrl: null }; },
    resume: async () => { onCheckout(quote ?? { offer: currentOffer, totalSatang: currentOffer.priceSatang }); return { attemptId: 'preview-attempt', state: 'PENDING', checkoutUrl: null }; },
    refresh: async () => ({ queued: true }), portal: async () => ({ url: 'https://billing.stripe.com/preview' }),
    document: async (_, kind) => ({ url: `https://invoice.stripe.com/preview?kind=${kind}` }),
    repairCapacity: async () => ({ operationId: 'preview-capacity-repair', queued: true }),
    repairPlanCapacity: async () => ({ operationId: 'preview-plan-repair', queued: true }),
    collection: async () => collection!,
    collectionPreview: async (action, target) => {
      collection = { id: 'preview-collection', companyId, action, state: 'PREVIEW', version: 1, previewHash: 'preview-hash',
        effectiveAt: date(periodDays), nextRenewalTotalSatang: target ? offers.find(offer => offer.offerKey === target.offerKey && offer.interval === target.interval)!.priceSatang : currentOffer.priceSatang,
        expiresAt: date(1), observedAt: date(), errorCode: null, allowedActions: ['submit', 'withdraw'],
        ...(target ? { targetOffer: offers.find(offer => offer.offerKey === target.offerKey && offer.interval === target.interval)! } : {}) };
      return collection;
    },
    collectionSubmit: async operation => {
      collection = { ...operation, state: 'SUCCEEDED', version: operation.version + 1, observedAt: date(), allowedActions: [] };
      if (operation.action === 'CANCEL_RENEWAL') status.cancelAtPeriodEnd = true;
      if (operation.action === 'RESUME_RENEWAL') status.cancelAtPeriodEnd = false;
      if (operation.action === 'SCHEDULE_DOWNGRADE') status.pendingPlanChange = collection;
      if (operation.action === 'CANCEL_DOWNGRADE') status.pendingPlanChange = null;
      status.observedAt = date(); return collection;
    },
    collectionWithdraw: async operation => { collection = { ...operation, state: 'CANCELLED', allowedActions: [] }; return collection; },
    recipient: async () => ({ hasCustomer: paid, email: 'preview@example.com', operation: recipient, busy: false }),
    recipientOperation: async () => recipient!,
    recipientPreview: async () => { throw new Error('อีเมลพรีวิวตรงกับผู้รับเอกสารแล้ว'); },
    recipientSubmit: async operation => { recipient = { ...operation, state: 'COMPLETED', canSubmit: false }; return recipient; },
    recipientCancel: async operation => { recipient = { ...operation, state: 'CANCELLED', canSubmit: false }; return recipient; },
  };
  return api;
}
