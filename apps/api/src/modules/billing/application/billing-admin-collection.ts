import { Prisma, type BillingAccount, type BillingOperation } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { BillingCollectionPause } from '@watchdog-bms/contracts';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { termProjectionHash } from '../domain/paid-invoice';
import { billingError, hashBilling } from '../domain/billing-policy';
import { stripeId, type StripeObject } from '../infrastructure/stripe.client';
import { subscriptionGraph } from './billing-schedule';
import { collectionSourceHash } from './billing-collection';
import type { BillingService } from './billing.service';

const review = () => billingError('CONTROL_COLLECTION_REVIEW', 'ข้อมูลการเก็บเงินเปลี่ยนหรือยังยืนยันไม่ได้ เปิดรายการเดิมเพื่อตรวจสอบ');
const json = (value: unknown) => value as Prisma.InputJsonValue;
/** After `expiresAt` nothing is sent; one hour later nothing sent can still be in flight. */
const SETTLE_MS = 3_600_000;
export function observedCollectionPause(sub: StripeObject): BillingCollectionPause | null {
  if (!sub.pause_collection) return null;
  return { behavior: ['keep_as_draft','void','mark_uncollectible'].includes(sub.pause_collection.behavior) ? sub.pause_collection.behavior : 'unknown',
    resumesAt: Number.isSafeInteger(sub.pause_collection.resumes_at) && sub.pause_collection.resumes_at > 0 && sub.pause_collection.resumes_at < 8640000000000 ? new Date(sub.pause_collection.resumes_at*1000).toISOString() : null };
}
export type AdminCollectionSource = {
  action: 'PAUSE'|'RESUME'; subscriptionId: string; before: BillingCollectionPause|null; after: BillingCollectionPause|null;
  providerHash: string; localHash: string; invoiceHash: string; openInvoices: number; draftInvoices: number; outstandingSatang: number;
  paidThrough: string|null; graceEndsAt: string|null; cancelAtPeriodEnd: boolean;
};
type Journal = { collectionControl?: { dispatchedAt?: string } };
const localHash = (account: BillingAccount, company: {status: string; planTerm: Parameters<typeof termProjectionHash>[0]}) =>
  hashBilling([account.baseSubscriptionId,account.paidThrough,account.graceEndsAt,account.cancelAtPeriodEnd,account.pendingPlanChangeId,company.status,termProjectionHash(company.planTerm)]);

/** Scoped provider-only control. Neither action grants service, quota or collects draft invoices. */
export class BillingAdminCollection {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService) {}
  private async invoices(account: BillingAccount) {
    const rows=(await this.billing.stripe.list('/invoices',{subscription:account.baseSubscriptionId},2)).filter(row=>['open','draft'].includes(row.status));
    for(const row of rows) if(row.object!=='invoice'||row.livemode!==account.livemode||stripeId(row.customer)!==account.customerId||
      stripeId(row.parent?.subscription_details?.subscription??row.subscription)!==account.baseSubscriptionId||row.currency!=='thb'||
      !Number.isSafeInteger(row.amount_remaining)||row.amount_remaining<0) throw review();
    const outstandingSatang=rows.reduce((sum,row)=>sum+row.amount_remaining,0);if(!Number.isSafeInteger(outstandingSatang))throw review();
    return {openInvoices:rows.filter(row=>row.status==='open').length,draftInvoices:rows.filter(row=>row.status==='draft').length,outstandingSatang,
      invoiceHash:hashBilling(rows.sort((a,b)=>a.id.localeCompare(b.id)).map(row=>[row.id,row.status,row.amount_remaining,row.auto_advance,row.attempt_count]))};
  }
  async source(account: BillingAccount, action: 'PAUSE'|'RESUME', resumesAt?: string): Promise<AdminCollectionSource> {
    if(!this.billing.stripe.enabled||!account.baseSubscriptionId||account.activeAttemptId||account.activeCollectionOperationId||
      (account.leaseUntil&&account.leaseUntil>new Date())||!['PAUSE','RESUME'].includes(action))throw review();
    const company=await this.prisma.client.company.findUniqueOrThrow({where:{id:account.companyId},include:{planTerm:true}});
    if(action==='RESUME'&&company.status!=='ACTIVE')throw review();
    const {sub,schedule}=await subscriptionGraph(this.billing.stripe,account);
    if(!['active','past_due','unpaid'].includes(sub.status)||sub.collection_method!=='charge_automatically'||sub.pending_update)throw review();
    const before=observedCollectionPause(sub);
    if(action==='RESUME'&&!before)throw review();
    let after:BillingCollectionPause|null=null;
    if(action==='PAUSE'){
      const at=new Date(resumesAt??'');
      if(!Number.isFinite(at.getTime())||at.toISOString()!==resumesAt||at.getTime()%1000||at.getTime()<Date.now()+600000||at.getTime()>Date.now()+365*86400000)throw review();
      after={behavior:'keep_as_draft',resumesAt:at.toISOString()};
    }else if(resumesAt!==undefined)throw review();
    return {action,subscriptionId:account.baseSubscriptionId,before,after,providerHash:collectionSourceHash(sub,schedule),localHash:localHash(account,company),
      ...await this.invoices(account),paidThrough:account.paidThrough?.toISOString()??null,graceEndsAt:account.graceEndsAt?.toISOString()??null,cancelAtPeriodEnd:account.cancelAtPeriodEnd};
  }
  async advance(account:BillingAccount,row:BillingOperation,lease:string,authorize:(tx:Prisma.TransactionClient,row:BillingOperation)=>Promise<void>){
    const p=row.proposedJson as unknown as {accountId:string;collectionChange:AdminCollectionSource},source=p.collectionChange;
    const journal=structuredClone((row.resultJson??{}) as Journal),progress=journal.collectionControl??={};
    const fence=async(tx:Prisma.TransactionClient,fresh=false)=>{
      await lockPlanTermCompany(tx,account.companyId);
      const current=await tx.billingAccount.findUniqueOrThrow({where:{id:account.id}});
      if(p.accountId!==account.id||current.activeCollectionOperationId!==row.id||current.baseSubscriptionId!==source.subscriptionId||current.leaseToken!==lease||!current.leaseUntil||current.leaseUntil<=new Date())throw review();
      if(fresh){
        const company=await tx.company.findUniqueOrThrow({where:{id:account.companyId},include:{planTerm:true}});
        if(row.expiresAt<=new Date()||current.activeAttemptId||localHash(current,company)!==source.localHash)throw review();
        await authorize(tx,row);
      }
    };
    const observed=(sub:StripeObject)=>{
      if(sub.metadata?.mangmeeCollectionControl!==row.id)return false;
      const pause=observedCollectionPause(sub);
      return hashBilling(pause)===hashBilling(source.after)||
        (source.action==='PAUSE'&&source.after?.resumesAt&&Date.parse(source.after.resumesAt)<=Date.now()&&!pause);
    };
    // Over without a change (2026-10-10): nothing is sent, the account is released in this transaction. Not applied keeps its review case;
    // never sent leaves nothing to review, so it opens none and closes one an older pass opened.
    const end=async(errorCode:'CONTROL_COLLECTION_NOT_SENT'|'CONTROL_COLLECTION_NOT_APPLIED')=>{
      await this.prisma.client.$transaction(async tx=>{
        await fence(tx);
        await tx.billingAccount.update({where:{id:account.id},data:{activeCollectionOperationId:null,version:{increment:1}}});
        await tx.billingOperation.update({where:{id:row.id},data:{state:'FAILED',errorCode,resultJson:json(journal),version:{increment:1}}});
        await tx.auditLog.create({data:{companyId:account.companyId,actorUserId:row.approverUserId,action:'billing.collection_control.ended',targetType:'BillingOperation',targetId:row.id,
          requestId:row.id,result:'FAILED',riskLevel:'CRITICAL',metadataJson:{errorCode,reason:row.reason,action:source.action,before:json(source.before)}}});
        if(errorCode==='CONTROL_COLLECTION_NOT_SENT')await tx.billingIssue.updateMany({where:{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,kind:'CUSTOMER_COLLECTION_REVIEW',referenceId:row.id},
          data:{state:'RESOLVED',resolvedAt:new Date(),version:{increment:1}}});
      });
      if(errorCode==='CONTROL_COLLECTION_NOT_APPLIED')await this.billing.issue(account.companyId,'CUSTOMER_COLLECTION_REVIEW',row.id);
    };
    try{
      let graph=await subscriptionGraph(this.billing.stripe,account);
      if(!observed(graph.sub)){
        // No send can leave after expiresAt (`fence(tx,true)`), so an hour later nothing is in flight. Our id travels in the same request as
        // the pause: a subscription without it never took this command.
        if(progress.dispatchedAt&&Date.now()-row.expiresAt.getTime()>=SETTLE_MS&&graph.sub.metadata?.mangmeeCollectionControl!==row.id)return await end('CONTROL_COLLECTION_NOT_APPLIED');
        if((source.after?.resumesAt&&Date.parse(source.after.resumesAt)<=Date.now()+60000)||
          collectionSourceHash(graph.sub,graph.schedule)!==source.providerHash||(await this.invoices(account)).invoiceHash!==source.invoiceHash)throw review();
        // The marker is kept only when it was stored, so that the send really follows it.
        const dispatchedAt=progress.dispatchedAt??new Date().toISOString();
        await this.prisma.client.$transaction(async tx=>{await fence(tx,true);
          await tx.billingOperation.update({where:{id:row.id},data:{state:'RUNNING',resultJson:json({...journal,collectionControl:{...progress,dispatchedAt}}),version:{increment:1}}});});
        progress.dispatchedAt=dispatchedAt;
        await this.billing.stripe.request('POST',`/subscriptions/${source.subscriptionId}`,{
          pause_collection:source.after?{behavior:'keep_as_draft',resumes_at:Date.parse(source.after.resumesAt!)/1000}:'',
          metadata:{mangmeeCollectionControl:row.id}},`mm:collection-control:${row.id}`);
        graph=await subscriptionGraph(this.billing.stripe,account);if(!observed(graph.sub))throw review();
      }
      const pause=observedCollectionPause(graph.sub);
      await this.prisma.client.$transaction(async tx=>{
        await fence(tx);
        await tx.billingAccount.update({where:{id:account.id},data:{collectionPauseJson:pause?json(pause):Prisma.DbNull,activeCollectionOperationId:null,observedAt:new Date(),version:{increment:1}}});
        await tx.billingOperation.update({where:{id:row.id},data:{state:'SUCCEEDED',observedAt:new Date(),errorCode:null,resultJson:json({...journal,observedPause:pause}),version:{increment:1}}});
        await tx.auditLog.create({data:{companyId:account.companyId,actorUserId:row.approverUserId,action:'billing.collection_control.applied',targetType:'BillingOperation',targetId:row.id,
          requestId:row.id,result:'SUCCESS',riskLevel:'CRITICAL',metadataJson:{reason:row.reason,initiatorUserId:row.initiatorUserId,approverUserId:row.approverUserId,
            before:json(source.before),after:json(pause),action:source.action,invoiceAction:'UNCHANGED',serviceAndQuotaAction:'UNCHANGED'}}});
        await tx.billingIssue.updateMany({where:{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,kind:'CUSTOMER_COLLECTION_REVIEW',referenceId:row.id},
          data:{state:'RESOLVED',resolvedAt:new Date(),version:{increment:1}}});
      });
    }catch{
      // Never sent, and past expiresAt no pass can send it: over at once.
      if(!progress.dispatchedAt&&row.expiresAt<=new Date())return end('CONTROL_COLLECTION_NOT_SENT');
      await this.prisma.client.$transaction(async tx=>{await fence(tx);await tx.billingOperation.update({where:{id:row.id},data:{state:progress.dispatchedAt?'UNKNOWN':'BLOCKED',
        errorCode:'CONTROL_COLLECTION_REVIEW',resultJson:json(journal),version:{increment:1}}});});
      await this.billing.issue(account.companyId,'CUSTOMER_COLLECTION_REVIEW',row.id);
    }
  }
}
