import type { Prisma } from '../../../generated/prisma/client';
import { BILLING_PAID_TIERS, SALES_DEAL_OPEN_STATUSES, type BillingOffer, type PaidTier, type SalesDealStatus } from '@watchdog-bms/contracts';
import { termProjectionHash } from '../domain/paid-invoice';
import { dealReturnAt, type DealSource } from '../domain/deal-offer';
import { writeSalesAttribution } from '../../sales-console/application/sales-attribution.write';
import { creditDeductions, withinReferralWindow, type CreditTakeBack } from '../../sales-console/domain/sales-attribution.logic';

/** Inside the existing Company-locked paid apply transaction; never called for a free Admin gift. */
export async function fulfillPaidPackageRequest(tx:Prisma.TransactionClient,companyId:string,accountId:string,invoiceId:string){
  const invoice=await tx.billingInvoice.findUnique({where:{id:invoiceId}});
  const offer=invoice?.offerSnapshot as Partial<BillingOffer>|null;
  if(!invoice||invoice.billingAccountId!==accountId||invoice.providerStatus!=='paid'||invoice.applyStatus!=='APPLIED'||!invoice.appliedAt||
    invoice.paidSatang<=0||invoice.paidSatang!==invoice.totalSatang||invoice.refundedSatang!==0||invoice.disputed||
    !BILLING_PAID_TIERS.includes(offer?.offerKey as PaidTier))return;
  const request=await tx.packageChangeRequest.findFirst({where:{companyId,status:'OPEN',requestedTierKey:offer!.offerKey,
    createdAt:{lte:invoice.appliedAt},paymentState:'NONE',paymentRef:null,slipAttachmentId:null}});
  if(!request)return;
  const [company,account,grant]=await Promise.all([
    tx.company.findUnique({where:{id:companyId},include:{planTerm:true}}),
    tx.billingAccount.findUnique({where:{id:accountId}}),
    tx.billingReceiptGrant.findFirst({where:{companyId,billingAccountId:accountId,sourceKey:invoiceId,
      kind:{in:['INITIAL','RENEWAL','REPEAT','UPGRADE']},revokedAt:null}}),
  ]);
  const term=company?.planTerm,now=new Date();
  if(!account||account.companyId!==companyId||company?.status!=='ACTIVE'||!term||term.termDisabledAt||term.termEndsAt<=now||
    term.billingReceiptAccountId!==accountId||term.tierKey!==offer!.offerKey||term.branchLimit!==offer!.branchLimit||
    term.employeeLimit!==offer!.employeeLimit||term.monthlySlipLimit!==offer!.monthlySlipLimit||termProjectionHash(term)!==account.termProjectionHash||
    !grant||grant.availableAt>now||grant.expiresAt<=now||!account.paidThrough||account.paidThrough<=now)return;
  const changed=await tx.packageChangeRequest.updateMany({where:{id:request.id,companyId,status:'OPEN',requestedTierKey:request.requestedTierKey,
    paymentState:'NONE',paymentRef:null,slipAttachmentId:null},data:{status:'APPROVED',decidedAt:invoice.appliedAt,decidedByUserId:null,
      paymentState:'STRIPE_APPLIED',paymentRef:invoice.id,verifiedAt:invoice.appliedAt}});
  if(changed.count!==1)return;
  await tx.auditLog.create({data:{companyId,actorType:'SYSTEM',actorRefId:'stripe-paid-application',action:'billing.package_request.fulfilled',
    targetType:'package_change_request',targetId:request.id,requestId:invoice.id,result:'SUCCESS',riskLevel:'HIGH',
    metadataJson:{source:'STRIPE_PAID_APPLICATION',invoiceId:invoice.id,billingAccountId:accountId,requestedTierKey:request.requestedTierKey,
      requestedByUserId:request.requestedByUserId,fromStatus:'OPEN',toStatus:'APPROVED',notificationSource:'billing.invoice.applied'}}});
}

/** A different unpaid LINE request cannot remain actionable after this company's first catalog purchase. */
// `status: 'OPEN'` alone already confines this to the customer lane: a SALES_DEAL row only ever
// holds a SALES_DEAL_STATUSES value (DRAFT…CANCELLED), never OPEN, so no `kind` filter is needed.
export async function supersedeUnpaidPackageRequest(tx: Prisma.TransactionClient, companyId: string, invoiceId: string) {
  const invoice = await tx.billingInvoice.findUnique({ where: { id: invoiceId }, select: { appliedAt: true, applyStatus: true } });
  if (!invoice?.appliedAt || invoice.applyStatus !== 'APPLIED') return;
  const request = await tx.packageChangeRequest.findFirst({ where: { companyId, status: 'OPEN', paymentState: 'NONE',
    paymentRef: null, slipAttachmentId: null, createdAt: { lte: invoice.appliedAt } } });
  if (!request) return;
  const changed = await tx.packageChangeRequest.updateMany({ where: { id: request.id, status: 'OPEN', paymentState: 'NONE',
    paymentRef: null, slipAttachmentId: null }, data: { status: 'CANCELLED', paymentState: 'CATALOG_SUPERSEDED', decidedAt: invoice.appliedAt } });
  if (changed.count !== 1) return;
  await tx.auditLog.create({ data: { companyId, actorType: 'SYSTEM', actorRefId: 'stripe-paid-application',
    action: 'billing.package_request.superseded', targetType: 'package_change_request', targetId: request.id,
    requestId: invoiceId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { invoiceId, requestedTierKey: request.requestedTierKey,
      fromStatus: 'OPEN', toStatus: 'CANCELLED', source: 'CATALOG_PURCHASE' } } });
}

/**
 * The deal half of a paid one-time apply (spec R6/§19.2, S13), inside the same transaction that
 * wrote the term, the grants and the invoice. Everything it needs is pinned in the snapshot the
 * quote froze, so it never re-reads Stripe and can never half-apply.
 *
 * EXPIRED is accepted next to APPROVED on purpose: the nightly sweep is meant to skip a deal with
 * a live Checkout (D-P3-9), and if it ever races one, the customer has still paid and must get
 * what they bought. The audit row records which status it came from.
 */
export async function applyDealRequest(tx: Prisma.TransactionClient, input: { companyId: string; invoiceId: string;
  deal: DealSource; priceSatang: number; paidAt: Date; serviceEnd?: Date }) {
  const deal = await tx.packageChangeRequest.findFirst({ where: { id: input.deal.requestId, companyId: input.companyId,
    kind: 'SALES_DEAL', status: { in: ['APPROVED', 'EXPIRED', 'PAID'] } } });
  if (!deal) return;
  // The status is the invariant, not the version: a concurrent edit that only bumped `version`
  // must not leave a paid customer with an unapplied deal row.
  const changed = await tx.packageChangeRequest.updateMany({ where: { id: deal.id, kind: 'SALES_DEAL', status: { in: ['APPROVED', 'EXPIRED', 'PAID'] },
      ...(deal.status === 'PAID' ? { paymentRef: input.invoiceId } : {}) },
    data: { status: 'APPLIED', paymentState: input.deal.cadence ? 'STRIPE_SUBSCRIPTION' : 'STRIPE_ONE_TIME',
      paymentRef: input.invoiceId, amountSatang: input.priceSatang,
      // `verifiedAt` is when Stripe took the money; `decidedAt` is when the term opened. The two
      // differ by minutes on a PromptPay QR the customer scans and leaves, so the console shows both.
      decidedAt: new Date(), verifiedAt: input.paidAt, version: { increment: 1 } } });
  if (changed.count !== 1) return;
  // D-P3-2: null leaves the platform default in place; zero is refused when the deal is written,
  // because closing AI is the `ai_line_assistant` menu, not a budget of nothing.
  if (input.deal.creditScope === 'CHAT' && !input.deal.cadence && !input.serviceEnd) {
    throw new Error('one-time deal chat credit requires its paid service end');
  }
  if (input.deal.creditScope === 'CHAT') await tx.companyAiConfiguration.upsert({
    where: { companyId: input.companyId },
    create: { companyId: input.companyId, salesDealChatCreditSatang: input.deal.aiMonthlyBudgetSatang,
      salesDealChatCreditEndsAt: input.deal.cadence ? null : input.serviceEnd },
    update: { salesDealChatCreditSatang: input.deal.aiMonthlyBudgetSatang,
      salesDealChatCreditEndsAt: input.deal.cadence ? null : input.serviceEnd } });
  // A v2/v3 deal means the old coupled value: a TOTAL that was also the chat credit. Since the TOTAL
  // is only the safety ceiling now (admin tab rework 2026-09-29), write the chat credit beside it on a
  // SHARED row, so an old deal still buys what it bought. A SPLIT row keeps its own chat cap.
  if (input.deal.creditScope !== 'CHAT' && input.deal.aiMonthlyBudgetSatang !== null) {
    await tx.companyAiConfiguration.upsert({
      where: { companyId: input.companyId },
      create: { companyId: input.companyId, monthlyBudgetSatang: input.deal.aiMonthlyBudgetSatang },
      update: { monthlyBudgetSatang: input.deal.aiMonthlyBudgetSatang } });
    await tx.companyAiConfiguration.updateMany({ where: { companyId: input.companyId, budgetMode: 'SHARED' },
      data: { chatMonthlyBudgetSatang: input.deal.aiMonthlyBudgetSatang } });
  }
  // §17.2: one row per company, ever — and D3 renewals never write one at all, because a renewal
  // is not a first activation. `writeSalesAttribution` re-checks the company anyway; skipping the
  // call keeps a renewal from ever being the row that wins the race.
  // D-P5-2: an auto-renewing deal sells ONE cycle, so the agent is credited with that cycle's
  // price and length — `months` on such a snapshot is not a duration anybody bought.
  const cadence = input.deal.cadence ?? null;
  if (!deal.renewalOfRequestId) await writeSalesAttribution(tx, { companyId: input.companyId,
    salesUserId: input.deal.salesUserId, source: 'DEAL', amountSatang: input.priceSatang,
    months: cadence ? (cadence === 'year' ? 12 : 1) : input.deal.months, interval: cadence ?? 'month', paidAt: input.paidAt,
    sourceInvoiceId: input.invoiceId, dealRequestId: deal.id });
  await tx.auditLog.create({ data: { companyId: input.companyId, actorType: 'SYSTEM', actorRefId: 'stripe-paid-application',
    action: 'sales.deal.applied', targetType: 'package_change_request', targetId: deal.id, requestId: input.invoiceId,
    result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { dealId: deal.id, invoiceId: input.invoiceId,
      months: input.deal.months, priceSatang: input.priceSatang, salesUserId: input.deal.salesUserId, fromStatus: deal.status } } });
}

/**
 * D-P5-6 — an N-cycle auto deal learns its return date the instant its first cycle opens.
 *
 * Only the DATE is written here. The `SCHEDULE_PRICE_RETURN` op itself is created later, in the
 * cycle that ends on that date, because a two-phase schedule whose first phase ends anywhere but
 * the account's current `paidThrough` is exactly what `currentSchedulePhase` refuses — and that
 * would take the customer's own cancel/resume buttons down for the whole life of the deal.
 */
export async function scheduleDealReturn(tx: Prisma.TransactionClient, input: { companyId: string;
  deal: DealSource; periodStart: Date }) {
  const cadence = input.deal.cadence, cycles = input.deal.cycles ?? null;
  if (!cadence || !cycles) return;
  const returnAt = dealReturnAt(input.periodStart, cadence, cycles, input.periodStart.getUTCDate());
  if (!returnAt) return;
  await tx.packageChangeRequest.updateMany({ where: { id: input.deal.requestId, companyId: input.companyId,
    kind: 'SALES_DEAL', returnAt: null }, data: { returnAt } });
}

/**
 * §17.1/§17.2 D6 — the REFERRAL half of the counting formula. A shop that names a sales code at
 * signup credits that agent for its FIRST paid activation, and only when the money arrives within
 * 14 days of the shop opening. After that nobody is credited, renewals included.
 *
 * A deal always wins: `applyDealRequest` runs in the same transaction and has already written the
 * DEAL row, which the one-row-per-company rule then refuses to overwrite. Both callers pass an
 * INITIAL purchase only — a top-up or a renewal never reaches here.
 *
 * Owner 2026-10-02 (RB-37): one base for both kinds of credit — the package price the shop was
 * charged, which is what a deal passes as `priceSatang`. Tax added on top of that price is not
 * sales credit; tax already inside the price leaves the invoice total equal to the price. Read
 * from the invoice's own verified total and tax, so an event discount is the charged price too.
 */
export async function recordReferralAttribution(tx: Prisma.TransactionClient, input: { companyId: string;
  invoiceId: string; offer: Pick<BillingOffer, 'interval' | 'intervalCount'>; paidAt: Date }) {
  const company = await tx.company.findUnique({ where: { id: input.companyId },
    select: { referralSalesUserId: true, referredAt: true } });
  if (!company?.referralSalesUserId || !withinReferralWindow(company.referredAt, input.paidAt)) return;
  const invoice = await tx.billingInvoice.findUnique({ where: { id: input.invoiceId },
    select: { totalSatang: true, taxSatang: true, contractSnapshot: true, applyStatus: true, appliedAt: true } });
  if (!invoice?.appliedAt || invoice.applyStatus !== 'APPLIED') return;
  const taxOnTop = (invoice.contractSnapshot as { policy?: { taxTreatment?: string } } | null)?.policy?.taxTreatment === 'EXCLUSIVE_VAT_7';
  const count = input.offer.intervalCount ?? 1;
  await writeSalesAttribution(tx, { companyId: input.companyId, salesUserId: company.referralSalesUserId,
    source: 'REFERRAL', amountSatang: invoice.totalSatang - (taxOnTop ? invoice.taxSatang : 0),
    months: input.offer.interval === 'year' ? count * 12 : count, interval: input.offer.interval,
    paidAt: input.paidAt, sourceInvoiceId: input.invoiceId });
}

/**
 * §17.1 "คืนเงิน/dispute ภายใน 60 วัน หักออกจากยอดเดือนที่คืน" (owner 2026-10-02). What went back
 * to the customer takes the credit back as dated rows of its own; the attribution row is never
 * rewritten — the shop was still opened by that agent, and rewriting it would change a month the
 * Owner has already read. `providerRef` is unique, so a refund or a dispute seen twice is one
 * deduction. The caller holds the company lock.
 */
export async function recordAttributionDeductions(tx: Prisma.TransactionClient, input: { companyId: string;
  invoiceId: string; takeBacks: readonly CreditTakeBack[] }) {
  if (input.takeBacks.length === 0) return;
  const row = await tx.salesAttribution.findUnique({ where: { companyId: input.companyId },
    select: { id: true, sourceInvoiceId: true, paidAt: true, amountSatang: true, refundedSatang: true,
      deductions: { select: { providerRef: true, amountSatang: true } } } });
  if (!row || row.sourceInvoiceId !== input.invoiceId) return;
  const data = creditDeductions(row, row.deductions, input.takeBacks).map((item) => ({ ...item, attributionId: row.id }));
  if (data.length > 0) await tx.salesAttributionDeduction.createMany({ data, skipDuplicates: true });
}

/**
 * R-676-4, the mirror of `supersedeUnpaidPackageRequest`: a shop that buys from the catalog while
 * an unpaid deal is still on offer has answered the offer. The deal closes so the team sees it in
 * "งานของฉัน" instead of chasing a shop that already paid.
 *
 * A deal with a live Checkout is left alone — that attempt resolves first, and #676 §5 forbids two
 * live Checkouts anyway.
 */
export async function supersedeUnpaidDeal(tx: Prisma.TransactionClient, companyId: string, invoiceId: string) {
  const invoice = await tx.billingInvoice.findUnique({ where: { id: invoiceId }, select: { appliedAt: true, applyStatus: true } });
  if (!invoice?.appliedAt || invoice.applyStatus !== 'APPLIED') return;
  // D3: a RENEWAL offer still waiting for the lead is answered by the same purchase, so it closes
  // from DRAFT/PENDING_APPROVAL too. A first-round deal in those states is left alone — the agent
  // is still writing it, and nothing has been shown to the customer yet.
  const deal = await tx.packageChangeRequest.findFirst({ where: { companyId, kind: 'SALES_DEAL',
    createdAt: { lte: invoice.appliedAt },
    OR: [{ status: 'APPROVED' }, { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, renewalOfRequestId: { not: null } }] } });
  if (!deal || !SALES_DEAL_OPEN_STATUSES.includes(deal.status as SalesDealStatus)) return;
  if (await tx.billingAttempt.findFirst({ where: { dealRequestId: deal.id, status: { notIn: ['COMPLETED', 'FAILED', 'EXPIRED'] } } })) return;
  const changed = await tx.packageChangeRequest.updateMany({ where: { id: deal.id, kind: 'SALES_DEAL', status: deal.status },
    data: { status: 'CANCELLED', paymentState: 'CATALOG_SUPERSEDED', decidedAt: invoice.appliedAt, version: { increment: 1 } } });
  if (changed.count !== 1) return;
  await tx.auditLog.create({ data: { companyId, actorType: 'SYSTEM', actorRefId: 'stripe-paid-application',
    action: 'sales.deal.superseded', targetType: 'package_change_request', targetId: deal.id, requestId: invoiceId,
    result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { invoiceId, salesUserId: deal.salesUserId,
      fromStatus: deal.status, toStatus: 'CANCELLED', source: 'CATALOG_PURCHASE' } } });
}
