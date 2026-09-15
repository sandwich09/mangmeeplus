import type { Prisma } from '../../../generated/prisma/client';
import type { BillingOffer } from '@watchdog-bms/contracts';
import { termProjectionHash } from '../domain/paid-invoice';

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
