import { BILLING_PAID_TIERS, billingOffer, type SalesDealCadence, type BillingCatalog, type BillingStatus, type BillingQuote, type BillingOffer, type BillingCollectionOperation, type BillingEmailRecipientOperation, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import type { billingApi } from './billing.api';
import { companyBillingProfile } from '@watchdog-bms/contracts';

export const previewScenarios = {
  start: 'ทดลองใช้ → ซื้อแพ็กเกจแรก', manual: 'บริษัทเดิม / วันและเมนูที่จะเปลี่ยน', deal: 'ข้อเสนอพิเศษจากทีมขาย', 'deal-auto': 'ข้อเสนอพิเศษ · ต่ออายุอัตโนมัติ', capacity: 'เลือกสาขาและผู้ใช้', 'capacity-work': 'งานค้างเกินแพ็กเกจที่เลือก', upgrade: 'มีแพ็กเกจ BASIC → ซื้อเพิ่มหรือเปลี่ยน', 'one-time': 'มีแพ็กเกจ BASIC แบบจ่ายครั้งเดียว',
  'one-time-pending': 'จ่ายแพ็กเกจรอบถัดไปแล้ว', 'one-time-capacity': 'จ่ายแล้ว · ต้องเลือกสิทธิ์ใหม่', 'scheduled-change': 'มีคำสั่งเปลี่ยนแพ็กเกจสิ้นรอบ', expired: 'แพ็กเกจหมดอายุ → ซื้อใหม่',
  pending: 'รอผลชำระเงิน', activating: 'จ่ายแล้ว รอเปิดสิทธิ์', success: 'สำเร็จ / ประวัติ', failed: 'ชำระไม่สำเร็จ',
  held: 'รอตรวจสอบ', 'quote-error': 'ราคาเปลี่ยน / ลองใหม่',
} as const;
export type PreviewScenario = keyof typeof previewScenarios;

// In-memory only: every method is supplied here, with no fallback to a live billing API.
export function createBillingPreview(companyId: string, scenario: PreviewScenario, selected: Pick<BillingQuote, 'offer' | 'totalSatang' | 'purchase' | 'purchaseMode' | 'deal'> | null, onCheckout: (quote: Pick<BillingQuote, 'offer' | 'totalSatang' | 'purchase' | 'purchaseMode' | 'deal'>) => void) {
  const date = (days = 0) => new Date(Date.now() + days * 86_400_000).toISOString();
  const currentOffer = selected?.offer ?? billingOffer('BASIC_499', 'month');
  // Preview uses calendar periods, matching the live anniversary/clamping rule.
  const extend = (start: string, interval: 'month' | 'year') => {
    const end = new Date(start), day = end.getUTCDate();
    end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + (interval === 'year' ? 12 : 1));
    end.setUTCDate(Math.min(day, new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()));
    return end.toISOString();
  };
  const prepaidChange = scenario === 'one-time-pending' || scenario === 'one-time-capacity';
  const currentPaidThrough = extend(date(), currentOffer.interval);
  const paidThrough = prepaidChange ? extend(currentPaidThrough, 'month') : selected?.purchase?.projectedPaidThrough ?? currentPaidThrough;
  const paid = ['success', 'upgrade', 'one-time', 'one-time-pending', 'one-time-capacity', 'activating', 'scheduled-change'].includes(scenario);
  const attempted = ['success', 'pending', 'activating', 'failed', 'held'].includes(scenario);
  const currentMode = scenario === 'one-time' || prepaidChange ? 'CARD_ONCE' : selected?.purchaseMode ?? 'CARD_AUTO';
  const currentOneTime = currentMode === 'CARD_ONCE' || currentMode === 'PROMPTPAY_ONCE';
  // Phase 6: ENTERPRISE is a normal card here — live, the API opens it as soon as its Stripe prices
  // are bound and keeps it COMING_SOON until then. `featureKeys` rides along from the tier presets.
  const offers: BillingOffer[] = (['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const).flatMap(tier => (['month', 'year'] as const).map(interval => ({
    ...billingOffer(tier, interval), availability: 'AVAILABLE', reason: null,
  })));
  const status: BillingStatus = {
    billingProfile: companyBillingProfile({ name: 'บริษัทตัวอย่าง · ข้อมูลพรีวิว', addressJson: {
      line1: '99 ถนนตัวอย่าง', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
    } }),
    companyId, companyName: 'บริษัทตัวอย่าง · ข้อมูลพรีวิว', mode: 'TEST', policyRevision: 'preview-policy',
    paymentState: paid ? 'PAID' : scenario === 'failed' ? 'FAILED' : attempted ? 'PENDING' : 'NONE',
    applyState: scenario === 'activating' ? 'PENDING' : scenario === 'held' ? 'HELD' : paid ? 'APPLIED' : 'NONE',
    accessState: scenario === 'expired' ? 'EXPIRED' : scenario === 'held' ? 'HELD' : 'ACTIVE',
    purchaseEligibility: 'ELIGIBLE', subscriptionState: paid && !currentOneTime ? 'active' : 'NONE', documentState: paid ? 'READY' : 'NONE',
    renewalMode: paid ? currentMode : 'NONE', enabledPurchaseModes: ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'],
    availablePurchaseModes: prepaidChange ? [] : scenario === 'upgrade' ? ['CARD_AUTO'] : scenario === 'one-time' ? ['CARD_ONCE', 'PROMPTPAY_ONCE'] : ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'],
    attemptId: attempted ? 'preview-attempt' : null, reference: attempted ? 'PREVIEW-0001' : null, observedAt: date(), canCancelCheckout: attempted && !paid,
    tierKey: paid || scenario === 'expired' ? currentOffer.offerKey : scenario === 'manual' ? 'PRO_999' : 'FREE_TRIAL_15', interval: paid || scenario === 'expired' ? currentOffer.interval : null,
    purchaseSource: scenario === 'manual' ? 'ADMIN_MANUAL' : paid ? 'PAID_CURRENT_MODE' : 'TRIAL',
    termEndsAt: scenario === 'expired' ? date(-1) : paidThrough, paidThrough: paid ? paidThrough : scenario === 'expired' ? date(-1) : null,
    nextChargeAt: paid && !currentOneTime ? paidThrough : null, cancelAtPeriodEnd: false, graceEndsAt: null,
    allowedActions: prepaidChange || attempted && !paid ? [] : paid ? currentOneTime ? ['new_sales'] : ['new_sales', 'portal_cancel_subscription', 'plan_changes', ...(currentMode === 'PROMPTPAY_RENEW' ? [] : ['portal_payment_method' as const])] : ['new_sales'],
    usage: { used: selected ? 0 : 6, limit: paid ? selected?.purchase?.projectedRemainingReceipts ?? currentOffer.receiptAllowance : 15, remaining: paid ? selected?.purchase?.projectedRemainingReceipts ?? currentOffer.receiptAllowance - 6 : 9,
      cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: prepaidChange ? currentPaidThrough : paidThrough }, issues: [],
  };
  // S44: a separate scenario, so the four pinned modes and prices of the other previews never move.
  // `status.deal` is the whole approved offer — the card draws from it alone, as it does live.
  const previewDeal = {
    dealId: 'preview-deal', base: 'PRO_999' as const, baseLabel: 'มืออาชีพ · ข้อเสนอพิเศษ',
    priceSatang: 599_000, months: 12, branchLimit: 3, employeeLimit: 10, monthlySlipLimit: 500,
    featureKeys: ['dashboard_notifications', 'expenses', 'reimbursement', 'reports'],
    aiMonthlyBudgetSatang: 80_000, description: 'ราคาพิเศษสำหรับร้านที่เปิดใหม่ ทีมขายดูแลตลอดสัญญา',
    offerExpiresAt: date(3), purchaseModes: ['CARD_ONCE', 'PROMPTPAY_ONCE'] as BillingPurchaseMode[],
    autoRenew: false, cadence: null as SalesDealCadence | null, cycles: null as number | null,
  };
  if (scenario === 'deal') status.deal = previewDeal;
  // D-P5-1/D-P5-4: the same offer sold per cycle instead of once — the card's modes, price line and
  // confirm wording all change, and only a scenario shows all three together.
  if (scenario === 'deal-auto') {
    status.deal = { ...previewDeal, priceSatang: 79_900, months: 1, purchaseModes: ['CARD_AUTO', 'PROMPTPAY_RENEW'],
      description: 'ราคาพิเศษต่อเนื่อง ทีมขายดูแลตลอดสัญญา', autoRenew: true, cadence: 'month' };
  }
  if (scenario === 'scheduled-change') {
    status.pendingPlanChange = { id: 'preview-scheduled-change', companyId, action: 'SCHEDULE_DOWNGRADE', state: 'SUCCEEDED', version: 2,
      previewHash: 'preview-hash', effectiveAt: paidThrough, nextRenewalTotalSatang: 24900, expiresAt: date(1), observedAt: date(),
      errorCode: null, allowedActions: [], targetOffer: offers.find(offer => offer.offerKey === 'STARTER_249' && offer.interval === 'month')! };
  }
  if (prepaidChange) {
    status.pendingPlanChange = { id: 'preview-prepaid-change', companyId, action: 'PREPAID_PLAN_CHANGE',
      state: scenario === 'one-time-capacity' ? 'BLOCKED' : 'SUCCEEDED', version: 3, previewHash: 'preview-prepaid-hash',
      effectiveAt: currentPaidThrough, nextRenewalTotalSatang: 24900, expiresAt: paidThrough, observedAt: date(),
      errorCode: scenario === 'one-time-capacity' ? 'BILLING_CAP_SELECTION_REQUIRED' : null, allowedActions: [],
      currentOffer, targetOffer: offers.find(offer => offer.offerKey === 'STARTER_249' && offer.interval === 'month')! };
    if (scenario === 'one-time-capacity') status.planCapacityRepair = { operationId: status.pendingPlanChange.id,
      version: status.pendingPlanChange.version, offerKey: 'STARTER_249', interval: 'month' };
  }
  let quote: BillingQuote | null = null, collection: BillingCollectionOperation | null = null, recipient: BillingEmailRecipientOperation | null = null;
  let quoteFailures = scenario === 'quote-error' ? 1 : 0;
  // R1: no trial block — new signups get none (Owner 2026-09-20), so the preview no longer emits one.
  const catalog = (): BillingCatalog => ({ schemaVersion: 1, mode: 'TEST', policyRevision: 'preview-policy', catalogRevision: 'preview-catalog',
    generatedAt: date(), validUntil: new Date(Date.now() + 60_000).toISOString(), taxTreatment: 'NOT_VAT_REGISTERED', offers, aiMonthlyBudgetSatang: 200_000 });
  const requiredQuote = () => {
    if (!quote) throw new Error('กรุณาเลือกแพ็กเกจและตรวจยอดก่อน');
    return quote;
  };
  const api: ReturnType<typeof billingApi> = {
    status: async () => ({ ...status }), catalog: async () => catalog(),
    history: async () => ({ items: paid ? [{ id: 'preview-invoice', number: 'PREVIEW-0001', currency: 'THB', amountSatang: currentOffer.priceSatang,
      refundedSatang: 0, disputed: false, financialObservedAt: date(), paymentState: 'PAID', applyState: status.applyState,
      periodStart: date(), periodEnd: paidThrough, createdAt: date(), hasDocuments: true }] : [], nextCursor: null }),
    attempt: async () => ({ attemptId: 'preview-attempt', state: status.applyState, errorCode: null, observedAt: date(),
      paymentState: status.paymentState === 'PAID' ? 'PAID' : status.paymentState === 'FAILED' ? 'FAILED' : 'PENDING', applyState: status.applyState, invoiceReference: paid ? 'PREVIEW-0001' : null,
      // The attempt is what tells the return page a deal paid for this term.
      ...(selected?.deal ? { deal: { dealId: previewDeal.dealId, baseLabel: previewDeal.baseLabel, months: previewDeal.months } } : {}) }),
    quote: async (offerKey, interval, billingEmail, capacity, purchaseMode, dealId) => {
      if (quoteFailures-- > 0) throw Object.assign(new Error('ราคาเปลี่ยนแล้ว'), { code: 'BILLING_QUOTE_STALE' });
      if (dealId) {
        // Priced from the deal snapshot, never from the catalog row (S36): N months in one
        // `intervalCount`, the deal's own limits, and receipts for the whole paid period. An
        // auto-renewing deal instead sells ONE cycle at a time (D-P5-2), so its offer is the
        // cadence with `intervalCount` 1 and a cycle's worth of receipts.
        const live = status.deal;
        const cycles = live?.autoRenew ? 1 : previewDeal.months;
        const dealOffer = { ...billingOffer(previewDeal.base, live?.autoRenew ? live.cadence ?? 'month' : 'month'),
          intervalCount: cycles, label: previewDeal.baseLabel,
          priceSatang: live?.priceSatang ?? previewDeal.priceSatang, branchLimit: previewDeal.branchLimit, employeeLimit: previewDeal.employeeLimit,
          monthlySlipLimit: previewDeal.monthlySlipLimit,
          receiptAllowance: previewDeal.monthlySlipLimit * (live?.autoRenew && live.cadence === 'year' ? 12 : cycles),
          availability: 'AVAILABLE', reason: null } as BillingOffer;
        quote = { quoteId: 'preview-deal-quote', companyId, companyName: status.companyName, billingProfile: status.billingProfile,
          policyRevision: 'preview-policy', expiresAt: date(1), offer: dealOffer, subtotalSatang: dealOffer.priceSatang, taxSatang: 0,
          totalSatang: dealOffer.priceSatang, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'preview-consent',
          purchaseMode: purchaseMode ?? 'CARD_ONCE', paidStart: 'IMMEDIATE', billingEmail, trialEndsAt: null, usage: status.usage,
          previousSource: 'NO_TERM', previousTermEndsAt: null,
          purchase: { kind: 'INITIAL', previousPaidThrough: null, projectedPaidThrough: date(previewDeal.months * 30),
            receiptUnitsAdded: dealOffer.receiptAllowance, projectedRemainingReceipts: dealOffer.receiptAllowance },
        };
        quote.deal = { dealId: previewDeal.dealId, months: previewDeal.months, description: previewDeal.description, baseLabel: previewDeal.baseLabel };
        return quote;
      }
      if (['capacity', 'capacity-work'].includes(scenario) && !capacity) throw Object.assign(new Error('เลือกสิทธิ์ก่อน'), { code: 'BILLING_CAP_SELECTION_REQUIRED' });
      const offer = offers.find(item => item.offerKey === offerKey && item.interval === interval)!;
      const isRepeat = paid && offer.offerKey === currentOffer.offerKey && (offer.interval === currentOffer.interval || (!currentOneTime && currentOffer.interval === 'month' && offer.interval === 'year'));
      const isUpgrade = paid && offer.interval === currentOffer.interval
        && BILLING_PAID_TIERS.findIndex(tier => tier === offer.offerKey) > BILLING_PAID_TIERS.findIndex(tier => tier === currentOffer.offerKey);
      const isScheduled = paid && currentOneTime && !isRepeat && !isUpgrade;
      if (paid && !isRepeat && !isUpgrade && !isScheduled) throw Object.assign(new Error('กรุณาติดต่อทีมงานเพื่อเปลี่ยนแพ็กเกจหรือรอบชำระ'), { code: 'BILLING_PLAN_CHANGE_REQUIRED' });
      if (isRepeat && currentOffer.interval !== offer.interval && status.pendingPlanChange) throw Object.assign(new Error('ตรวจรายการเปลี่ยนแพ็กเกจก่อน'), { code: 'BILLING_CADENCE_PENDING_CHANGE' });
      const total = isUpgrade ? offer.priceSatang - currentOffer.priceSatang : offer.priceSatang;
      const added = isUpgrade ? offer.receiptAllowance - currentOffer.receiptAllowance : offer.receiptAllowance;
      const trialUnits = !paid && scenario !== 'expired' && scenario !== 'manual' ? status.usage.remaining ?? 0 : 0;
      quote = { quoteId: 'preview-quote', companyId, companyName: status.companyName, billingProfile: status.billingProfile, policyRevision: 'preview-policy', expiresAt: date(1),
        offer, subtotalSatang: total, taxSatang: 0, totalSatang: total, taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'preview-consent', purchaseMode: purchaseMode ?? 'CARD_AUTO',
        paidStart: 'IMMEDIATE', billingEmail, trialEndsAt: !paid && scenario !== 'expired' && scenario !== 'manual' ? date(7) : null, usage: status.usage,
        ...(scenario === 'manual' ? { previousSource: 'ADMIN_MANUAL' as const, previousTermEndsAt: status.termEndsAt,
          featureImpact: { removed: [{ featureKey: 'reports', labelTh: 'รายงาน' }], added: [], preservedAdmin: 1 } } : {}),
        purchase: { kind: isUpgrade ? 'UPGRADE' : isRepeat ? 'REPEAT' : isScheduled ? 'SCHEDULED_CHANGE' : scenario === 'expired' ? 'RESTART' : 'INITIAL', previousPaidThrough: status.paidThrough, ...(isRepeat && currentOffer.interval !== offer.interval ? { previousInterval: currentOffer.interval } : {}),
          projectedPaidThrough: isUpgrade ? paidThrough : extend(isRepeat || isScheduled ? paidThrough : date(), offer.interval), receiptUnitsAdded: added,
          projectedRemainingReceipts: (isScheduled ? 0 : paid ? status.usage.remaining ?? 0 : trialUnits) + added,
          ...(trialUnits > 0 ? { trialCarryover: { receiptUnits: trialUnits, expiresAt: extend(date(), offer.interval) } } : {}) },
        // This fixture's current paid period starts now; a live quote prorates over its actual paid segments.
        ...(isUpgrade ? { upgrade: { prorationAt: date(), nextRenewalTotalSatang: offer.priceSatang,
          segments: [{ start: date(), end: paidThrough, amountSatang: total, receiptUnitsAdded: added }] } } : {}),
        ...(capacity ? { capacity: { retainedBranches: capacity.branchIds.map(id => id === 'ho' ? 'สำนักงานใหญ่' : 'สาขาตัวอย่าง'), suspendedBranches: ['สาขาที่ไม่เลือก'],
          retainedMembers: ['เจ้าของร้าน', ...capacity.memberships.slice(1).map(() => 'พนักงานตัวอย่าง')], suspendedMembers: ['พนักงานที่ไม่เลือก'], defaults: [] } } : {}),
      };
      return quote;
    },
    capacity: async (offerKey, interval) => {
      const offer = offers.find(item => item.offerKey === offerKey && item.interval === interval)!;
      return { companyId, offerKey, interval: offer.interval, sourceHash: `preview-capacity-${offerKey}-${interval}`, branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit,
        overCapacity: true, branches: Array.from({ length: offer.branchLimit + 1 }, (_, i) => ({ id: i ? `branch-${i}` : 'ho', name: i ? `สาขาตัวอย่าง ${i}` : 'สำนักงานใหญ่', headOffice: !i, required: !i || (scenario === 'capacity-work' && i === 1), openReimbursements: scenario === 'capacity-work' && i === 1 ? 1 : 0 })),
        memberships: Array.from({ length: offer.employeeLimit + 1 }, (_, i) => ({ id: i ? `member-${i}` : 'owner', name: i ? `พนักงานตัวอย่าง ${i}` : 'เจ้าของร้าน', owner: !i, required: !i || (scenario === 'capacity-work' && i === 1), allBranches: true, branchIds: ['ho'], defaultBranchId: 'ho' })) };
    },
    checkout: async () => { onCheckout(requiredQuote()); return { attemptId: 'preview-attempt', state: 'PENDING', checkoutUrl: null }; },
    resume: async () => { onCheckout(quote ?? { offer: currentOffer, totalSatang: currentOffer.priceSatang, purchaseMode: 'CARD_AUTO' }); return { attemptId: 'preview-attempt', state: 'PENDING', checkoutUrl: null }; },
    cancelCheckout: async () => { status.attemptId = null; status.canCancelCheckout = false; status.paymentState = 'FAILED'; status.allowedActions = ['new_sales']; return { state: 'EXPIRED' }; },
    refresh: async () => ({ queued: true }), portal: async () => ({ url: 'https://billing.stripe.com/preview' }),
    document: async (_, kind) => ({ url: `https://invoice.stripe.com/preview?kind=${kind}` }),
    repairCapacity: async () => ({ operationId: 'preview-capacity-repair', queued: true }),
    repairPlanCapacity: async () => ({ operationId: 'preview-plan-repair', queued: true }),
    collection: async id => id === status.pendingPlanChange?.id ? status.pendingPlanChange : collection!,
    collectionPreview: async (action, target) => {
      collection = { id: `preview-collection-${crypto.randomUUID()}`, companyId, action, state: 'PREVIEW', version: 1, previewHash: 'preview-hash',
        effectiveAt: paidThrough, nextRenewalTotalSatang: target ? offers.find(offer => offer.offerKey === target.offerKey && offer.interval === target.interval)!.priceSatang : currentOffer.priceSatang,
        expiresAt: date(1), observedAt: date(), errorCode: null, allowedActions: ['submit', 'withdraw'],
        ...(target ? { targetOffer: offers.find(offer => offer.offerKey === target.offerKey && offer.interval === target.interval)!,
          capacity: { retainedBranches: target.capacity.branchIds.map(id => id === 'ho' ? 'สำนักงานใหญ่' : `สาขาตัวอย่าง ${id.split('-')[1]}`),
            suspendedBranches: ['สาขาที่ไม่เลือก'], retainedMembers: target.capacity.memberships.map(member => member.id === 'owner' ? 'เจ้าของร้าน' : `พนักงานตัวอย่าง ${member.id.split('-')[1]}`), suspendedMembers: ['พนักงานที่ไม่เลือก'], defaults: [] } } : {}) };
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
