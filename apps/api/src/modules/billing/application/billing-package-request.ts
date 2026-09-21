import type { Prisma } from '../../../generated/prisma/client';
import type { BillingOffer } from '@watchdog-bms/contracts';
import { termProjectionHash } from '../domain/paid-invoice';
import type { DealSource } from '../domain/deal-offer';

/** Inside the existing Company-locked paid apply transaction; never called for a free Admin gift. */
export async function fulfillPaidPackageRequest(tx:Prisma.TransactionClient,companyId:string,accountId:string,invoiceId:string){
  const invoice=await tx.billingInvoice.findUnique({where:{id:invoiceId}});
  const offer=invoice?.offerSnapshot as Partial<BillingOffer>|null;
  if(!invoice||invoice.billingAccountId!==accountId||invoice.providerStatus!=='paid'||invoice.applyStatus!=='APPLIED'||!invoice.appliedAt||
    invoice.paidSatang<=0||invoice.paidSatang!==invoice.totalSatang||invoice.refundedSatang!==0||invoice.disputed||
    !['STARTER_249','BASIC_499','PRO_999'].includes(offer?.offerKey??''))return;
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
  deal: DealSource; priceSatang: number; paidAt: Date }) {
  const deal = await tx.packageChangeRequest.findFirst({ where: { id: input.deal.requestId, companyId: input.companyId,
    kind: 'SALES_DEAL', status: { in: ['APPROVED', 'EXPIRED'] } } });
  if (!deal) return;
  // The status is the invariant, not the version: a concurrent edit that only bumped `version`
  // must not leave a paid customer with an unapplied deal row.
  const changed = await tx.packageChangeRequest.updateMany({ where: { id: deal.id, kind: 'SALES_DEAL', status: { in: ['APPROVED', 'EXPIRED'] } },
    data: { status: 'APPLIED', paymentState: 'STRIPE_ONE_TIME', paymentRef: input.invoiceId, amountSatang: input.priceSatang,
      // `verifiedAt` is when Stripe took the money; `decidedAt` is when the term opened. The two
      // differ by minutes on a PromptPay QR the customer scans and leaves, so the console shows both.
      decidedAt: new Date(), verifiedAt: input.paidAt, version: { increment: 1 } } });
  if (changed.count !== 1) return;
  // D-P3-2: null leaves the platform default in place; zero is refused when the deal is written,
  // because closing AI is the `ai_line_assistant` menu, not a budget of nothing.
  if (input.deal.aiMonthlyBudgetSatang !== null) await tx.companyAiConfiguration.upsert({
    where: { companyId: input.companyId },
    create: { companyId: input.companyId, monthlyBudgetSatang: input.deal.aiMonthlyBudgetSatang },
    update: { monthlyBudgetSatang: input.deal.aiMonthlyBudgetSatang } });
  // §17.2: one row per company, ever. `skipDuplicates` on the unique companyId is the whole rule.
  await tx.salesAttribution.createMany({ data: [{ companyId: input.companyId, salesUserId: input.deal.salesUserId,
    source: 'DEAL', amountSatang: input.priceSatang, months: input.deal.months, interval: 'month', paidAt: input.paidAt,
    sourceInvoiceId: input.invoiceId, dealRequestId: deal.id }], skipDuplicates: true });
  await tx.auditLog.create({ data: { companyId: input.companyId, actorType: 'SYSTEM', actorRefId: 'stripe-paid-application',
    action: 'sales.deal.applied', targetType: 'package_change_request', targetId: deal.id, requestId: input.invoiceId,
    result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { dealId: deal.id, invoiceId: input.invoiceId,
      months: input.deal.months, priceSatang: input.priceSatang, salesUserId: input.deal.salesUserId, fromStatus: deal.status } } });
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
  const deal = await tx.packageChangeRequest.findFirst({ where: { companyId, kind: 'SALES_DEAL', status: 'APPROVED',
    createdAt: { lte: invoice.appliedAt } } });
  if (!deal) return;
  if (await tx.billingAttempt.findFirst({ where: { dealRequestId: deal.id, status: { notIn: ['COMPLETED', 'FAILED', 'EXPIRED'] } } })) return;
  const changed = await tx.packageChangeRequest.updateMany({ where: { id: deal.id, kind: 'SALES_DEAL', status: 'APPROVED' },
    data: { status: 'CANCELLED', paymentState: 'CATALOG_SUPERSEDED', decidedAt: invoice.appliedAt, version: { increment: 1 } } });
  if (changed.count !== 1) return;
  await tx.auditLog.create({ data: { companyId, actorType: 'SYSTEM', actorRefId: 'stripe-paid-application',
    action: 'sales.deal.superseded', targetType: 'package_change_request', targetId: deal.id, requestId: invoiceId,
    result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { invoiceId, salesUserId: deal.salesUserId,
      fromStatus: 'APPROVED', toStatus: 'CANCELLED', source: 'CATALOG_PURCHASE' } } });
}
