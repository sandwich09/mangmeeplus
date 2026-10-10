import { billingApprovalMode, canApproveBillingChange } from './billing-approval';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BILLING_PROMOTION_REVIEW_ISSUE, type BillingEndPackageReview, type BillingRefundInput, type BillingRefundPromotion, type BillingRefundReview, type BillingRefundOperation, type BillingPromotionSnapshot, type BillingStatus } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingInvoice, BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { invoiceServiceEnd } from '../domain/billing-package';
import { assertKeys, assertRefundControlPolicy, billingError, configurationHash } from '../domain/billing-policy';
import { StripeRequestError } from '../infrastructure/stripe.client';
import { BillingService } from './billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';
import { recordBillingFinancials } from './billing-financial';
import { invoicePaymentMethod, pendingRefund, refundSource, refundParams, refundPreview, observedRefund, refundReviewRequired } from './billing-refund-source';
import { endPackageBlock, endPackageError, endPaidPackage, refundEndsPackage, renewalIsLive, stampSpentPromotion } from './billing-end-package';
import { promotionForInvoice } from './billing-promotion';

type Proposed={accountId:string;customerId:string;chargeId:string;membershipId:string;actorCompanyId:string;sourceHash:string;localHash:string;providerSourceHash:string;
  settingsVersion:number;policyRevisionId:string;amountSatang:number;memo:string;notifyCustomer:boolean;invoiceNumber:string|null;
  paidSatang:number;previousRefundedSatang:number;usage:BillingStatus['usage'];projection:Awaited<ReturnType<typeof refundPreview>>;params:Record<string,unknown>;endPackage?:boolean;
  /** The promotion redemption of the refunded invoice, pinned at preview so every later step answers for the same source (spec Q6). */
  promotionRedemptionId?:string};
type Journal={submittedCredentialVersion?:string;approval?:{membershipId:string;companyId:string;credentialVersion:string;approvedAt:string};
  dispatchedAt?:string;providerKey?:string;paramsHash?:string;mutationResolved?:boolean;creditNoteId?:string;creditNoteNumber?:string;refundId?:string;refundState?:BillingRefundOperation['refundState'];packageEnded?:boolean;
  /** The provider's last rejection of this request: its own error code and type, never its message. */
  providerError?:{outcome:string;code:string|null;type:string|null;at:string}};
const stale=()=>billingError('CONTROL_PREVIEW_STALE','รายการเปลี่ยนหรือหมดอายุ กรุณาโหลดข้อมูลล่าสุดแล้วตรวจใหม่');
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const localHash=(a:BillingAccount,i:BillingInvoice)=>configurationHash([a.id,a.companyId,a.stripeAccountId,a.livemode,a.customerId,
  a.activeAttemptId,a.activeCollectionOperationId,i.id,i.version,i.providerInvoiceId,i.providerChargeId,i.totalSatang,i.paidSatang,i.taxSatang,i.subscriptionId,i.providerStatus,i.refundedSatang,i.disputed]);

@Injectable()
export class BillingRefundsService {
  private readonly logger=new Logger(BillingRefundsService.name);
  constructor(private readonly prisma:PrismaService,private readonly billing:BillingService,private readonly admin:BillingAdminService,private readonly configuration:BillingConfigurationService,private readonly lifecycle:PartnerLifecycleTransitionUseCase){}
  private async access(context:RequestContext,companyId:string,key='system.billing.financial.read',tx:Prisma.TransactionClient=this.prisma.client){
    const scoped=await this.admin.scopedCompany(context,companyId,tx);await this.admin.access(context,'system.billing.financial.read',tx);await this.admin.access(context,key,tx);
    if(!scoped.account)throw new NotFoundException();return scoped as typeof scoped&{account:BillingAccount};
  }
  private async invoice(account:BillingAccount,id:string,tx:Prisma.TransactionClient=this.prisma.client){
    const row=await tx.billingInvoice.findFirst({where:{id,billingAccountId:account.id}});if(!row)throw new NotFoundException();return row;
  }
  private async packageBlock(tx:Prisma.TransactionClient,account:BillingAccount,invoiceId:string,requireFullRefund=false){
    const company=await tx.company.findUniqueOrThrow({where:{id:account.companyId},include:{planTerm:true}});
    return endPackageBlock(company,account,await this.invoice(account,invoiceId,tx),requireFullRefund);
  }
  /**
   * Spec Q6, decided at preview and pinned in the proposal. A refund that brings a promotion purchase to its full paid amount (cumulative,
   * real money only) always ends its unused entitlement, whatever the operator asked; a partial one keeps time and quota, so asking to end
   * it is refused. Any other invoice: the operator's choice, as before.
   */
  private async refundEnd(invoiceId:string,paidSatang:number,previousRefundedSatang:number,input:Pick<BillingRefundInput,'amountSatang'|'endPackage'>){
    const promo=await promotionForInvoice(this.prisma.client,invoiceId),full=previousRefundedSatang+input.amountSatang>=paidSatang;
    if(promo&&!full&&input.endPackage===true)throw endPackageError('BILLING_END_PACKAGE_NOT_REFUNDED');
    return {endPackage:input.endPackage===true||(!!promo&&full),...promo?{promotionRedemptionId:promo.id}:{}};
  }
  /**
   * Why the package end this refund asks for cannot run now, or null. For a pinned promotion purchase "nothing is running" is no reason (the refund
   * still goes, staff adjust the entitlement); a live renewal or a pending purchase still is. The renewal is judged on its own there (plan R14):
   * until that source's service is over, a live one would still charge at its benefit end, so staff cancel it first, whatever else makes the source not current.
   */
  private async refundBlock(tx:Prisma.TransactionClient,account:BillingAccount,invoiceId:string,p:Pick<Proposed,'endPackage'|'promotionRedemptionId'>){
    const block=p.endPackage?await this.packageBlock(tx,account,invoiceId):null;
    if(block!=='BILLING_END_PACKAGE_NOT_CURRENT'||!p.promotionRedemptionId)return block;
    return renewalIsLive(account)&&invoiceServiceEnd(await this.invoice(account,invoiceId,tx))>new Date()?'BILLING_END_PACKAGE_AUTO_RENEW' as const:null;
  }
  /** What the refund screens tell about the promotion this invoice was bought with, or nothing: named by the invoice's own snapshot, sized by its redemption. */
  private async promotion(invoice:Pick<BillingInvoice,'id'|'contractSnapshot'|'benefitEnd'>|null):Promise<{promotion?:BillingRefundPromotion}>{
    const promo=invoice&&await promotionForInvoice(this.prisma.client,invoice.id);
    return promo?{promotion:{displayName:(invoice.contractSnapshot as {promotion?:BillingPromotionSnapshot}|null)?.promotion?.displayName??'',bonusMonths:promo.bonusMonths,
      bonusReceiptUnits:promo.bonusReceiptUnits,benefitEnd:invoice.benefitEnd?.toISOString()??null}}:{};
  }
  /** The invoice is still the promotion purchase the proposal pinned (or still none), so execute answers for the source it previewed. */
  private async pinned(tx:Prisma.TransactionClient,invoiceId:string,p:Pick<Proposed,'promotionRedemptionId'>){
    return ((await promotionForInvoice(tx,invoiceId))?.id??null)===(p.promotionRedemptionId??null);
  }
  private async row(context:RequestContext,id:string,tx:Prisma.TransactionClient=this.prisma.client){
    const row=await tx.billingOperation.findFirst({where:{id,type:'REFUND',stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode}});
    if(!row?.companyId)throw new NotFoundException();await this.access(context,row.companyId,'system.billing.financial.read',tx);return row;
  }
  private async credential(tx:Prisma.TransactionClient,userId:string){
    if(tx!==this.prisma.client)await tx.$queryRaw`SELECT id FROM "UserCredential" WHERE "userId"=${userId} FOR SHARE`;
    const row=await tx.userCredential.findUnique({where:{userId}});
    if(!row||row.status!=='ACTIVE'||row.mustChangePassword||(row.expiresAt&&row.expiresAt<=new Date()))throw new ForbiddenException();return row.updatedAt.toISOString();
  }
  private async actors(row:BillingOperation,tx:Prisma.TransactionClient,needApproval=true){
    const p=row.proposedJson as unknown as Proposed,j=(row.resultJson??{}) as Journal;
    await this.configuration.operationActor(row,row.initiatorUserId,p.membershipId,p.actorCompanyId,'system.billing.refund.manage',tx,row.companyId!);
    if(await this.credential(tx,row.initiatorUserId)!==j.submittedCredentialVersion)throw new ForbiddenException();
    if(needApproval){const a=j.approval;if(!a||!row.approverUserId)throw new ForbiddenException();
      const approver=await this.configuration.operationActor(row,row.approverUserId,a.membershipId,a.companyId,'system.billing.approval.approve',tx,row.companyId!);
      await this.configuration.requireApprovalActor(row,approver,'system.billing.refund.manage',tx);
      if(await this.credential(tx,row.approverUserId)!==a.credentialVersion)throw new ForbiddenException();}
  }
  private async policy(amount:number,tx:Prisma.TransactionClient=this.prisma.client){
    const state=await this.billing.settings(tx);assertRefundControlPolicy(state.policy,true);
    if(!state.gates.refunds||!state.revision)throw billingError('CONTROL_REFUNDS_CLOSED','ยังไม่เปิดรับคำขอคืนเงิน ติดต่อผู้ดูแลการตั้งค่า');
    if(amount>state.policy!.refundLimitSatang!)throw billingError('CONTROL_REFUND_LIMIT','ยอดนี้เกินวงเงินต่อคำขอ กรุณาติดต่อผู้ดูแลวงเงิน');return state;
  }
  private async source(context:RequestContext,companyId:string,invoiceId:string){
    const {account,company,access}=await this.access(context,companyId),row=await this.invoice(account,invoiceId),state=await this.billing.settings();
    const source=await refundSource(this.billing.stripe,account,row),current=await this.access(context,companyId),latest=await this.invoice(current.account,invoiceId);
    if(localHash(account,row)!==localHash(current.account,latest))throw stale();
    const sourceHash=configurationHash([localHash(account,row),source.sourceHash,state.settings.version,state.revision?.id??null]);
    return {account,company:current.company,access:current.access,row,state,source,sourceHash};
  }
  async review(context:RequestContext,companyId:string,invoiceId:string):Promise<BillingRefundReview>{
    const s=await this.source(context,companyId,invoiceId),limit=s.state.policy?.refundLimitSatang??null;
    const pending=await pendingRefund(this.prisma.client,s.account);
    const blocked=!s.access.capabilities.includes('system.billing.refund.manage')?'CONTROL_PERMISSION_CHANGED':!s.state.gates.refunds||!limit?'CONTROL_REFUNDS_CLOSED':
      s.account.activeAttemptId||s.account.activeCollectionOperationId||pending?'BILLING_REFUND_PENDING':s.source.charge.disputed?'CONTROL_REFUND_DISPUTED':
        s.source.refunds.some(r=>!['succeeded','failed','canceled'].includes(r.status))?'CONTROL_REFUND_PENDING':
          s.source.charge.amount_refunded>=s.row.paidSatang||s.source.invoice.post_payment_credit_notes_amount>=s.row.paidSatang?'CONTROL_REFUND_FULL':null;
    return {companyId,companyName:s.company.name,invoiceId,invoiceNumber:s.row.providerNumber,mode:s.account.livemode?'LIVE':'TEST',
      paidSatang:s.row.paidSatang,refundedSatang:s.source.charge.amount_refunded,disputed:s.source.charge.disputed,refundLimitSatang:limit,
      canCreate:blocked===null,blockedReason:blocked,sourceHash:s.sourceHash,observedAt:new Date().toISOString(),usage:await this.billing.usage(companyId),adjustments:s.source.adjustments,paymentMethod:invoicePaymentMethod(s.row),...await this.promotion(s.row)};
  }
  async preview(context:RequestContext,companyId:string,invoiceId:string,input:BillingRefundInput){
    assertKeys(input,['amountSatang','reason','memo','notifyCustomer','sourceHash','endPackage']);
    if(!Number.isSafeInteger(input.amountSatang)||input.amountSatang<1||input.amountSatang>2147483647||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||
      typeof input.memo!=='string'||input.memo.length>500||typeof input.notifyCustomer!=='boolean'||(input.endPackage!==undefined&&typeof input.endPackage!=='boolean')||typeof input.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceHash))throw new BadRequestException();
    await this.access(context,companyId,'system.billing.refund.manage');const s=await this.source(context,companyId,invoiceId),state=await this.policy(input.amountSatang);
    if(s.sourceHash!==input.sourceHash||state.settings.version!==s.state.settings.version)throw stale();
    const end=await this.refundEnd(invoiceId,s.row.paidSatang,s.source.charge.amount_refunded,input);
    const id=randomUUID(),memo=input.memo.trim(),params=await refundParams(this.billing.stripe,s.account,s.row,s.source,id,input.amountSatang,memo,input.notifyCustomer);
    const projection=await refundPreview(this.billing.stripe,s.account,s.row,s.source,params),usage=await this.billing.usage(companyId);
    const p:Proposed={accountId:s.account.id,customerId:s.account.customerId!,chargeId:s.row.providerChargeId!,membershipId:context.membershipId,actorCompanyId:context.companyId,sourceHash:s.sourceHash,localHash:localHash(s.account,s.row),
      providerSourceHash:s.source.sourceHash,settingsVersion:state.settings.version,policyRevisionId:state.revision!.id,amountSatang:input.amountSatang,memo,notifyCustomer:input.notifyCustomer,
      invoiceNumber:s.row.providerNumber,paidSatang:s.row.paidSatang,previousRefundedSatang:s.source.charge.amount_refunded,usage,projection,params,...end};
    const row=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,companyId);const {account}=await this.access(context,companyId,'system.billing.refund.manage',tx);
      if(localHash(account,await this.invoice(account,invoiceId,tx))!==p.localHash||(await this.policy(p.amountSatang,tx)).settings.version!==p.settingsVersion)throw stale();
      if(account.activeAttemptId||account.activeCollectionOperationId||await pendingRefund(tx,account))throw billingError('BILLING_REFUND_PENDING','ตรวจคำสั่งเดิมให้เสร็จก่อนเริ่มคำขอคืนเงิน');
      const block=await this.refundBlock(tx,account,invoiceId,p);if(block)throw endPackageError(block);
      return tx.billingOperation.create({data:{id,companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,type:'REFUND',referenceId:invoiceId,
        sourceVersion:s.row.version,proposedJson:json(p),reason:input.reason.trim(),initiatorUserId:context.userId,
        requestHash:configurationHash([id,invoiceId,p,input.reason.trim()]),expiresAt:new Date(Date.now()+600000)}});
    });return this.view(context,row);
  }
  private async view(context:RequestContext,row:BillingOperation):Promise<BillingRefundOperation>{
    const {company,access}=await this.access(context,row.companyId!),p=row.proposedJson as unknown as Proposed,j=(row.resultJson??{}) as Journal;
    const own=row.initiatorUserId===context.userId,fresh=row.expiresAt>new Date(),manage=access.capabilities.includes('system.billing.refund.manage'),approve=access.capabilities.includes('system.billing.approval.approve');
    const issue=await this.prisma.client.billingIssue.findFirst({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id}});
    // The journal keeps the last rejection, but it explains an error only while the request still has one (a retry that went through leaves nothing to explain).
    const providerError=row.errorCode?j.providerError:undefined,invoice=await this.prisma.client.billingInvoice.findUnique({where:{id:row.referenceId!}});
    return {id:row.id,type:'REFUND',state:row.state as BillingRefundOperation['state'],scope:{kind:'COMPANY',companyId:row.companyId!,mode:row.livemode?'LIVE':'TEST'},version:row.version,
      reason:row.reason,initiatorUserId:row.initiatorUserId,approverUserId:row.approverUserId,approvalMode:billingApprovalMode(row),errorCode:row.errorCode,createdAt:row.createdAt.toISOString(),observedAt:row.observedAt?.toISOString()??null,
      expiresAt:row.expiresAt.toISOString(),referenceId:row.referenceId,sourceVersion:row.sourceVersion,previewHash:row.requestHash,companyName:company.name,invoiceNumber:p.invoiceNumber,
      amountSatang:p.amountSatang,taxSatang:p.projection.taxSatang,memo:p.memo,notifyCustomer:p.notifyCustomer,paidSatang:p.paidSatang,previousRefundedSatang:p.previousRefundedSatang,usage:p.usage,
      allowedActions:[...(own&&manage&&fresh&&row.state==='PREVIEW'?['submit' as const]:[]),...(canApproveBillingChange(access,row.initiatorUserId,context.userId,'system.billing.refund.manage')&&fresh&&row.state==='AWAITING_APPROVAL'?['approve' as const]:[]),
        ...(!j.dispatchedAt&&['PREVIEW','AWAITING_APPROVAL','QUEUED','BLOCKED'].includes(row.state)&&(manage||approve)&&(!row.leaseUntil||row.leaseUntil<=new Date())?['cancel' as const]:[]),
        // A rejected create is over: running it again would only send the same request the provider already refused, so staff start a new one. The same goes for a create the provider never made.
        ...((manage||approve)&&['QUEUED','RUNNING','UNKNOWN','BLOCKED','FAILED'].includes(row.state)&&!['CONTROL_REFUND_PROVIDER_REJECTED','CONTROL_REFUND_NOT_CREATED'].includes(row.errorCode??'')&&(!row.leaseUntil||row.leaseUntil<=new Date())?['run' as const]:[])],
      dispatchedAt:j.dispatchedAt??null,creditNoteId:j.creditNoteId??null,creditNoteNumber:j.creditNoteNumber??null,refundId:j.refundId??null,refundState:j.refundState??null,providerErrorCode:providerError?.code??null,providerErrorType:providerError?.type??null,reviewCaseId:issue?.id??null,bankReceiptConfirmed:false,endPackage:p.endPackage===true,packageEnded:j.packageEnded??null,
      ...invoice?{paymentMethod:invoicePaymentMethod(invoice)}:{},...p.promotionRedemptionId?await this.promotion(invoice):{}};
  }
  async get(context:RequestContext,id:string){return this.view(context,await this.row(context,id));}
  async list(context:RequestContext,companyId:string,invoiceId:string,cursor?:string){
    const {account}=await this.access(context,companyId);await this.invoice(account,invoiceId);
    const anchor=cursor?await this.row(context,cursor):null;if(anchor&&(anchor.companyId!==companyId||anchor.referenceId!==invoiceId))throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{companyId,referenceId:invoiceId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,type:'REFUND',
      ...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    return {items:await Promise.all(rows.slice(0,25).map(r=>this.view(context,r))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  private valid(row:BillingOperation,version:number,hash:string){
    if(row.version!==version||row.requestHash!==hash||row.requestHash!==configurationHash([row.id,row.referenceId,row.proposedJson,row.reason]))throw stale();
  }
  private async current(row:BillingOperation,tx:Prisma.TransactionClient){
    if(row.expiresAt<=new Date())throw stale();
    const p=row.proposedJson as unknown as Proposed,account=await this.billing.account(row.companyId!,tx);if(!account||account.id!==p.accountId)throw stale();
    if(localHash(account,await this.invoice(account,row.referenceId!,tx))!==p.localHash)throw stale();
    const state=await this.policy(p.amountSatang,tx);if(state.settings.version!==p.settingsVersion||state.revision?.id!==p.policyRevisionId)throw stale();
    if(account.activeAttemptId||account.activeCollectionOperationId||await pendingRefund(tx,account,row.id))throw billingError('BILLING_REFUND_PENDING','ยังมีคำสั่งเดิมที่ต้องตรวจสอบ');
    if(!await this.pinned(tx,row.referenceId!,p))throw stale();
    // Submit, approve and dispatch all re-check, so money never moves on a package this refund cannot end.
    const block=await this.refundBlock(tx,account,row.referenceId!,p);if(block)throw endPackageError(block);return account;
  }
  private audit(tx:Prisma.TransactionClient,row:BillingOperation,action:string,actor?:string){
    return tx.auditLog.create({data:{companyId:row.companyId,actorUserId:actor??null,...!actor?{actorType:'SERVICE',actorRefId:'billing-refund-worker'}:{},action:`billing.refund.${action}`,targetType:'BillingOperation',targetId:row.id,requestId:row.id,
      result:'SUCCESS',riskLevel:'CRITICAL',metadataJson:{sourceHash:row.requestHash,invoiceId:row.referenceId,state:row.state,version:row.version,approvalMode:billingApprovalMode(row),initiatorUserId:row.initiatorUserId,approverUserId:row.approverUserId}}});
  }
  async command(context:RequestContext,id:string,action:'submit'|'approve'|'cancel',version:number,hash:string,key?:string){
    const original=await this.row(context,id);
    if(action==='submit'&&(!key||!/^[a-zA-Z0-9_-]{16,120}$/.test(key)))throw new BadRequestException();
    const row=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,original.companyId!);const current=await this.row(context,id,tx),p=current.proposedJson as unknown as Proposed,j=(current.resultJson??{}) as Journal;
      const scope=await this.access(context,current.companyId!,'system.billing.financial.read',tx);
      const permission=action==='approve'?'system.billing.approval.approve':'system.billing.refund.manage';
      if(!scope.access.capabilities.includes(permission)&&!(action==='cancel'&&scope.access.capabilities.includes('system.billing.approval.approve')))throw new ForbiddenException();
      await this.configuration.requireProof(context,tx);
      if(action==='submit'){
        const replay=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:current.stripeAccountId,livemode:current.livemode,idempotencyKey:key!}}});
        if(replay&&(replay.id!==current.id||replay.initiatorUserId!==context.userId||replay.requestHash!==hash))throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','ข้อมูลคำขอต่างจากรายการเดิม กรุณาเปิดคำขอเดิมหรือตรวจใหม่');
      }
      if(action==='submit'&&current.idempotencyKey===key&&current.initiatorUserId===context.userId&&current.requestHash===hash&&current.state!=='PREVIEW')return current;
      if(action==='approve'&&current.approverUserId===context.userId&&current.requestHash===hash&&j.approval)return current;
      if(action==='cancel'&&current.state==='CANCELLED'&&current.requestHash===hash)return current;
      this.valid(current,version,hash);
      if(current.leaseUntil&&current.leaseUntil>new Date())throw stale();
      if(action==='cancel'){
        if(j.dispatchedAt||!['PREVIEW','AWAITING_APPROVAL','QUEUED','BLOCKED'].includes(current.state))throw stale();
      }else{
        if(current.expiresAt<=new Date())throw stale();await this.current(current,tx);
        if(action==='submit'){
          if(current.initiatorUserId!==context.userId||current.state!=='PREVIEW')throw new ForbiddenException();
          j.submittedCredentialVersion=await this.credential(tx,context.userId);
        }else{
          if(current.state!=='AWAITING_APPROVAL')throw new ForbiddenException();
          await this.configuration.requireApprovalActor(current,context,'system.billing.refund.manage',tx);
          await this.actors(current,tx,false);j.approval={membershipId:context.membershipId,companyId:context.companyId,credentialVersion:await this.credential(tx,context.userId),approvedAt:new Date().toISOString()};
        }
      }
      const updated=await tx.billingOperation.update({where:{id},data:{state:action==='submit'?'AWAITING_APPROVAL':action==='approve'?'QUEUED':'CANCELLED',
        ...action==='submit'?{idempotencyKey:key}:{},...action==='approve'?{approverUserId:context.userId}:{},resultJson:json(j),version:{increment:1}}});
      if(action==='cancel')await resolveBillingIssue(tx,{companyId:updated.companyId,stripeAccountId:updated.stripeAccountId,livemode:updated.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:updated.id},'UNDISPATCHED_REFUND_CANCELLED');
      await this.audit(tx,updated,action,context.userId);return updated;
    });return this.view(context,row);
  }
  private async fence(tx:Prisma.TransactionClient,id:string,lease:string){
    const row=await tx.billingOperation.findUniqueOrThrow({where:{id}});await lockPlanTermCompany(tx,row.companyId!);
    await tx.$queryRaw`SELECT id FROM "BillingAccount" WHERE id=${(row.proposedJson as unknown as Proposed).accountId} FOR UPDATE`;
    const account=await this.billing.account(row.companyId!,tx);
    if(row.type!=='REFUND'||row.stripeAccountId!==this.billing.stripe.accountId||row.livemode!==this.billing.stripe.livemode||row.state!=='RUNNING'||row.leaseToken!==lease||!row.leaseUntil||row.leaseUntil<=new Date()||!account||account.id!==(row.proposedJson as unknown as Proposed).accountId||
      account.leaseToken!==lease||!account.leaseUntil||account.leaseUntil<=new Date())throw stale();return {row,account};
  }
  async run(context:RequestContext,id:string,version:number){
    const row=await this.row(context,id),view=await this.view(context,row);
    const {access}=await this.access(context,row.companyId!);if(!access.capabilities.some(key=>key==='system.billing.refund.manage'||key==='system.billing.approval.approve'))throw new ForbiddenException();
    if(row.version!==version||!view.allowedActions.includes('run'))throw stale();
    await this.configuration.requireProof(context,this.prisma.client);await this.execute(row);return this.get(context,id);
  }
  private async execute(candidate:BillingOperation){
    const lease=randomUUID();
    const claim=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,candidate.companyId!);const current=await tx.billingOperation.findUniqueOrThrow({where:{id:candidate.id}}),account=await this.billing.account(candidate.companyId!,tx),now=new Date();
      if(current.companyId!==candidate.companyId||current.stripeAccountId!==candidate.stripeAccountId||current.livemode!==candidate.livemode||current.type!=='REFUND'||current.version!==candidate.version||!['QUEUED','RUNNING','UNKNOWN','BLOCKED','FAILED'].includes(current.state)||!account||account.id!==(current.proposedJson as unknown as Proposed).accountId||
        (current.leaseUntil&&current.leaseUntil>now)||(account.leaseUntil&&account.leaseUntil>now))return null;
      const got=await tx.billingAccount.updateMany({where:{id:account.id,OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseToken:lease,leaseUntil:new Date(now.getTime()+120000)}});if(!got.count)return null;
      return tx.billingOperation.update({where:{id:current.id},data:{state:'RUNNING',leaseToken:lease,leaseUntil:new Date(now.getTime()+120000),version:{increment:1}}});
    });if(!claim)return;
    const p=claim.proposedJson as unknown as Proposed;let creating=false;
    try{
      const account=await this.billing.account(claim.companyId!),invoice=await this.invoice(account!,claim.referenceId!);
      if(account!.customerId!==p.customerId||invoice.providerChargeId!==p.chargeId||invoice.providerInvoiceId!==p.params.invoice)throw refundReviewRequired();
      let source=await refundSource(this.billing.stripe,account!,invoice),journal=(claim.resultJson??{}) as Journal;
      let observed=journal.dispatchedAt?await observedRefund(this.billing.stripe,account!,invoice,source,claim.id,p.providerSourceHash,p.amountSatang,p.memo,configurationHash(p.projection),journal.creditNoteId):null;
      if(!observed){
        // Never created: `current` refuses every send once expiresAt has passed, so the last send of this request left at or before expiresAt (plus the 120 s lease at most). An hour later nothing is in flight
        // and nothing will be sent again, and the read above listed every credit note of the invoice (completeList) with none carrying this operation's id; a create that did land is found by observedRefund
        // and never comes here. So the request ends without a refund, in the catch below, and stops holding the company's other refunds. (This is always earlier than the former 23-hour ceiling on a resend.)
        if(journal.dispatchedAt&&Date.now()-claim.expiresAt.getTime()>=3600000)throw billingError('CONTROL_REFUND_NOT_CREATED','ตรวจกับผู้ให้บริการรับชำระเงินแล้ว ไม่พบการคืนเงินของคำขอนี้ คำขอนี้จึงไม่ได้คืนเงิน ถ้ายังต้องการคืน ให้สร้างคำขอใหม่');
        if(source.sourceHash!==p.providerSourceHash||configurationHash(await refundPreview(this.billing.stripe,account!,invoice,source,p.params))!==configurationHash(p.projection))throw refundReviewRequired();
        journal=await this.prisma.client.$transaction(async tx=>{
          const {row}=await this.fence(tx,claim.id,lease);this.valid(row,row.version,row.requestHash);await this.actors(row,tx);await this.current(row,tx);
          const j=(row.resultJson??{}) as Journal,providerKey=`billing-refund-${row.id}`,paramsHash=configurationHash(p.params);
          if(j.dispatchedAt&&(j.providerKey!==providerKey||j.paramsHash!==paramsHash))throw refundReviewRequired();
          const updated={...j,dispatchedAt:j.dispatchedAt??new Date().toISOString(),providerKey,paramsHash};
          const saved=await this.writeLeased(tx,row,lease,{resultJson:json(updated)});await this.audit(tx,saved,j.dispatchedAt?'redispatch':'dispatch');return updated;
        });
        creating=true;await this.billing.stripe.request('POST','/credit_notes',p.params,journal.providerKey);creating=false;
        source=await refundSource(this.billing.stripe,account!,invoice);
        observed=await observedRefund(this.billing.stripe,account!,invoice,source,claim.id,p.providerSourceHash,p.amountSatang,p.memo,configurationHash(p.projection));
        if(!observed)throw refundReviewRequired();
      }
      await this.prisma.client.$transaction(async tx=>{
        if(p.endPackage)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${claim.companyId}`}))`;
        const {row,account:current}=await this.fence(tx,claim.id,lease),invoiceNow=await this.invoice(current,claim.referenceId!,tx);
        if(current.customerId!==account!.customerId||invoiceNow.providerChargeId!==invoice.providerChargeId||invoiceNow.providerInvoiceId!==invoice.providerInvoiceId||invoiceNow.paidSatang!==invoice.paidSatang)throw refundReviewRequired();
        await recordBillingFinancials(tx,current,invoiceNow,{refundedSatang:source.charge.amount_refunded,disputed:source.charge.disputed});
        const terminal=observed!.refundState==='succeeded'?'SUCCEEDED':['failed','canceled'].includes(observed!.refundState)?'FAILED':'QUEUED';
        const packageEnded=await this.endRefundedPackage(tx,p,terminal,row,current);
        const saved=await this.writeLeased(tx,row,lease,{state:terminal,resultJson:json({...((row.resultJson??{}) as Journal),...observed!,mutationResolved:true,...packageEnded===undefined?{}:{packageEnded}}),
          observedAt:new Date(),errorCode:terminal==='FAILED'?'CONTROL_REFUND_FAILED':null,scheduledFor:new Date(Date.now()+300000),leaseToken:null,leaseUntil:null,version:{increment:1}});
        if(terminal==='SUCCEEDED')await resolveBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id},'ORIGINAL_REFUND_SUCCEEDED');
        else if(terminal==='FAILED'||observed!.refundState==='requires_action')await detectBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id});
        await this.audit(tx,saved,'observed');
      });
    }catch(error){
      // The provider's own error code and type say why it refused; nothing else of its response is kept (stripe.client.ts).
      const providerError=error instanceof StripeRequestError?{outcome:error.outcome,code:error.providerCode??null,type:error.providerType??null,at:new Date().toISOString()}:null;
      if(providerError)this.logger.warn({msg:'billing.refund.provider_rejected',operationId:claim.id,outcome:providerError.outcome,providerCode:providerError.code,providerType:providerError.type});
      // The create itself answered 400 or 402: the provider made nothing, and the same idempotency key would only replay that answer, so the request ends here
      // and stops holding the company's other refunds. 409 (key still in use), 429, 5xx, no answer, any error of a read, and a key the provider says was used with other parameters stay unknown as before.
      const rejected=creating&&error instanceof StripeRequestError&&error.outcome==='REJECTED'&&(error.status===400||error.status===402)&&error.providerType!=='idempotency_error';
      await this.prisma.client.$transaction(async tx=>{
        const {row}=await this.fence(tx,claim.id,lease),j=(row.resultJson??{}) as Journal;
        const code=rejected?'CONTROL_REFUND_PROVIDER_REJECTED':error instanceof ForbiddenException?'CONTROL_PERMISSION_CHANGED':error instanceof StripeRequestError?'CONTROL_REFUND_PROVIDER_UNAVAILABLE':
          (error as {getResponse?:()=>{code?:string}}).getResponse?.()?.code??'CONTROL_REFUND_REVIEW';
        // Two ways a dispatched request ends with no refund: the provider refused the create, or (the check in the try) it never made one.
        const notCreated=code==='CONTROL_REFUND_NOT_CREATED',ended=rejected||notCreated;
        const saved=await this.writeLeased(tx,row,lease,{state:ended?'FAILED':j.dispatchedAt?'UNKNOWN':'BLOCKED',errorCode:code,...providerError||ended?{resultJson:json({...j,...providerError?{providerError}:{},...ended?{mutationResolved:true}:{}})}:{},scheduledFor:new Date(Date.now()+300000),leaseToken:null,leaseUntil:null,version:{increment:1}});
        await detectBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id});await this.audit(tx,saved,rejected?'rejected':notCreated?'not_created':'review');
      });
    }finally{await this.prisma.client.billingAccount.updateMany({where:{id:p.accountId,leaseToken:lease},data:{leaseToken:null,leaseUntil:null,nextReconcileAt:new Date()}});}
  }
  /** A term that already ended or moved to another purchase is left alone; a live renewal or pending purchase waits for staff. A promotion source nothing could end or settle is opened as a review. */
  private async endRefundedPackage(tx:Prisma.TransactionClient,p:Pick<Proposed,'endPackage'|'promotionRedemptionId'>,terminal:string,row:BillingOperation,account:BillingAccount){
    if(!refundEndsPackage(p,terminal))return undefined;
    if(!await this.pinned(tx,row.referenceId!,p))throw refundReviewRequired();
    const block=await endPaidPackage(tx,this.lifecycle,{companyId:row.companyId!,accountId:account.id,invoiceId:row.referenceId!,requireFullRefund:false,
      actorUserId:null,requestId:row.id,reason:row.reason,refundOperationId:row.id});
    if(block&&block!=='BILLING_END_PACKAGE_NOT_CURRENT')throw endPackageError(block);
    // Spec Q6: nothing of a promotion source is running, so only a source with nothing left of it is settled. Any other (not started, held,
    // replaced, or a renewal that went live after the gate) waits for staff, and no tool ends it: the review on the invoice is how they see it.
    // The redemption stays CONSUMED and the campaign usage is never lowered; an entitlement already adjusted is not a case for staff.
    if(block&&p.promotionRedemptionId&&!await stampSpentPromotion(tx,{accountId:account.id,invoiceId:row.referenceId!})&&!(await promotionForInvoice(tx,row.referenceId!))?.entitlementAdjustedAt)
      await detectBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:BILLING_PROMOTION_REVIEW_ISSUE,referenceId:row.referenceId!});
    return !block;
  }
  async endPackageReview(context:RequestContext,companyId:string,invoiceId:string):Promise<BillingEndPackageReview>{
    const {account,access}=await this.access(context,companyId),block=await this.packageBlock(this.prisma.client,account,invoiceId,true);
    return {canEnd:!block&&access.capabilities.includes('system.billing.refund.manage'),blockedReason:block};
  }
  /** Standalone end for an invoice already refunded in full (before this control existed, or in Stripe). */
  async endPackage(context:RequestContext,companyId:string,invoiceId:string,reason:string){
    if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw new BadRequestException();
    await this.prisma.client.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${companyId}`}))`;await lockPlanTermCompany(tx,companyId);
      const {account}=await this.access(context,companyId,'system.billing.refund.manage',tx);await this.configuration.requireProof(context,tx);
      if(await pendingRefund(tx,account))throw billingError('BILLING_REFUND_PENDING','ตรวจคำขอคืนเงินเดิมให้เสร็จก่อนยุติแพ็กเกจ');
      const block=await endPaidPackage(tx,this.lifecycle,{companyId,accountId:account.id,invoiceId,requireFullRefund:true,actorUserId:context.userId,requestId:randomUUID(),reason:reason.trim()});
      if(block)throw endPackageError(block);
    });
    return this.endPackageReview(context,companyId,invoiceId);
  }
  private async writeLeased(tx:Prisma.TransactionClient,row:BillingOperation,lease:string,data:Prisma.BillingOperationUpdateManyMutationInput){
    const changed=await tx.billingOperation.updateMany({where:{id:row.id,version:row.version,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data});
    if(!changed.count)throw stale();return tx.billingOperation.findUniqueOrThrow({where:{id:row.id}});
  }
  async drain(){
    const now=new Date(),rows=await this.prisma.client.billingOperation.findMany({where:{type:'REFUND',stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,
      state:{in:['QUEUED','UNKNOWN','RUNNING']},AND:[{OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},{OR:[{scheduledFor:null},{scheduledFor:{lte:now}}]}]},orderBy:[{updatedAt:'asc'},{id:'asc'}],take:5});
    let failed=0;for(const row of rows){try{await this.execute(row);}catch{failed++;}}return {processed:rows.length,failed};
  }
}
