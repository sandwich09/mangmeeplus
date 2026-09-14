import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {BillingAccount,BillingAttempt,BillingOperation,Prisma} from '../../../generated/prisma/client';
import type {BillingCheckoutAttempts,BillingCheckoutReview,BillingCheckoutExpiryOperation} from '@watchdog-bms/contracts';
import {PrismaService} from '../../../common/database/prisma.service';
import type {RequestContext} from '../../auth/domain/models/request-context.model';
import {lockPlanTermCompany} from '../../system-partner-management/application/lock-plan-term-company';
import {BillingAdminService} from './billing-admin.service';
import {BillingService} from './billing.service';
import {BillingReconcilerService} from './billing-reconciler.service';
import {assertKeys,billingError,configurationHash} from '../domain/billing-policy';
import {StripeRequestError} from '../infrastructure/stripe.client';
import {checkoutExpiryBinding,readCheckoutExpiry} from './billing-checkout-expiry-source';
import {detectBillingIssue,resolveBillingIssue} from './billing-issues';
const TYPE='EXPIRE_CHECKOUT',MANAGE='system.billing.gate.manage';
const stale=()=>billingError('CONTROL_PREVIEW_STALE','รายการเปลี่ยนหรือคำขอหมดอายุ กรุณาโหลดหน้าชำระเดิมแล้วตรวจใหม่');
const json=(v:unknown)=>v as Prisma.InputJsonValue;
type Proposed={accountId:string;membershipId:string;actorCompanyId:string;sourceHash:string;bindingHash:string;sessionId:string;expiresAt:string};
type Journal={dispatchedAt?:string;providerKey?:string;providerState?:'open'|'expired'|'complete';paymentState?:'paid'|'unpaid'|'no_payment_required'};
const binding=(account:BillingAccount,attempt:BillingAttempt)=>checkoutExpiryBinding({...account,activeAttemptId:null},attempt);

/** One retained original Checkout command; subscription/quota recovery stays in the existing reconciler. */
@Injectable()
export class BillingCheckoutExpiryService{
  constructor(private readonly prisma:PrismaService,private readonly admin:BillingAdminService,private readonly billing:BillingService,private readonly reconciler:BillingReconcilerService){}
  private scope(){return {stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode};}
  private async access(context:RequestContext,companyId:string,key='system.billing.read',tx:Prisma.TransactionClient=this.prisma.client){
    const source=await this.admin.scopedCompany(context,companyId,tx);await this.admin.access(context,key,tx);if(!source.account)throw new NotFoundException();return {...source,account:source.account};
  }
  private async attempt(account:BillingAccount,id:string,tx:Prisma.TransactionClient=this.prisma.client){const row=await tx.billingAttempt.findFirst({where:{id,billingAccountId:account.id}});if(!row)throw new NotFoundException();return row;}
  private async row(context:RequestContext,id:string,tx:Prisma.TransactionClient=this.prisma.client){const row=await tx.billingOperation.findFirst({where:{id,type:TYPE,...this.scope()}});if(!row?.companyId)throw new NotFoundException();await this.access(context,row.companyId,'system.billing.read',tx);return row;}
  private valid(row:BillingOperation){if(row.type!==TYPE||!row.companyId||!row.referenceId||row.stripeAccountId!==this.billing.stripe.accountId||row.livemode!==this.billing.stripe.livemode||row.requestHash!==configurationHash([TYPE,row.id,row.referenceId,row.proposedJson,row.reason]))throw stale();}
  private async lockCompanies(tx:Prisma.TransactionClient,companyId:string,actorCompanyId:string){for(const id of [...new Set([companyId,actorCompanyId])].sort())await lockPlanTermCompany(tx,id);}
  private async actor(row:BillingOperation,tx:Prisma.TransactionClient){
    this.valid(row);const p=row.proposedJson as Proposed;
    if(tx!==this.prisma.client){
      await tx.$queryRaw`SELECT m.id FROM "CompanyMembership" m JOIN "User" u ON u.id=m."userId" JOIN "MembershipRole" mr ON mr."membershipId"=m.id
        JOIN "Role" r ON r.id=mr."roleId" JOIN "RolePermission" rp ON rp."roleId"=r.id WHERE m.id=${p.membershipId} AND u.id=${row.initiatorUserId} ORDER BY r.id,rp."permissionId" FOR SHARE OF m,u,mr,r,rp`;
      await tx.$queryRaw`SELECT id FROM "BillingOperatorScope" WHERE "userId"=${row.initiatorUserId} AND "companyId"=${row.companyId} FOR SHARE`;
    }
    const context=await this.admin.authorizeOperation(row,MANAGE,tx);await this.admin.access(context,'system.billing.read',tx);return context;
  }
  async attempts(context:RequestContext,companyId:string,cursor?:string):Promise<BillingCheckoutAttempts>{
    const {account,company}=await this.access(context,companyId),anchor=cursor?await this.attempt(account,cursor):null;
    const rows=await this.prisma.client.billingAttempt.findMany({where:{billingAccountId:account.id,...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    return {companyName:company.name,items:rows.slice(0,25).map(row=>({id:row.id,companyId,createdAt:row.createdAt.toISOString(),state:row.status,hasCheckout:!!row.checkoutSessionId,channel:row.channel==='line'?'line':'web'})),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async review(context:RequestContext,companyId:string,id:string):Promise<BillingCheckoutReview>{
    const source=await this.access(context,companyId),attempt=await this.attempt(source.account,id);
    if(!attempt.checkoutSessionId)return {companyId,companyName:source.company.name,attemptId:id,mode:source.account.livemode?'LIVE':'TEST',sourceHash:null,providerState:null,paymentState:null,expiresAt:null,canExpire:false,blockedReason:'CONTROL_CHECKOUT_REFERENCE_PENDING'};
    const observed=await readCheckoutExpiry(this.billing.stripe,source.account,attempt),current=await this.access(context,companyId);
    if(checkoutExpiryBinding(current.account,await this.attempt(current.account,id))!==observed.sourceHash)throw stale();
    return {companyId,companyName:current.company.name,attemptId:id,mode:current.account.livemode?'LIVE':'TEST',sourceHash:observed.sourceHash,
      providerState:observed.providerState,paymentState:observed.paymentState,expiresAt:observed.expiresAt,canExpire:observed.canExpire&&current.access.capabilities.includes(MANAGE),blockedReason:!observed.canExpire?'CONTROL_CHECKOUT_ALREADY_CLOSED':!current.access.capabilities.includes(MANAGE)?'CONTROL_PERMISSION_CHANGED':null};
  }
  async preview(context:RequestContext,companyId:string,id:string,input:{reason:string;sourceHash:string}){
    assertKeys(input,['reason','sourceHash']);if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||typeof input.sourceHash!=='string')throw new BadRequestException();
    const {account}=await this.access(context,companyId,MANAGE),attempt=await this.attempt(account,id),observed=await readCheckoutExpiry(this.billing.stripe,account,attempt);
    if(!observed.canExpire||observed.sourceHash!==input.sourceHash)throw stale();
    const p:Proposed={accountId:account.id,membershipId:context.membershipId,actorCompanyId:context.companyId,sourceHash:observed.sourceHash,bindingHash:binding(account,attempt),sessionId:observed.sessionId,expiresAt:observed.expiresAt},operationId=randomUUID(),reason=input.reason.trim();
    const row=await this.prisma.client.$transaction(async tx=>{
      await this.lockCompanies(tx,companyId,context.companyId);const current=await this.access(context,companyId,MANAGE,tx);
      if(checkoutExpiryBinding(current.account,await this.attempt(current.account,id,tx))!==p.sourceHash)throw stale();
      return tx.billingOperation.create({data:{id:operationId,companyId,...this.scope(),type:TYPE,referenceId:id,sourceVersion:attempt.version,proposedJson:json(p),reason,initiatorUserId:context.userId,
        requestHash:configurationHash([TYPE,operationId,id,p,reason]),expiresAt:new Date(Date.now()+600000)}});
    });return this.view(context,row);
  }
  private async view(context:RequestContext,row:BillingOperation):Promise<BillingCheckoutExpiryOperation>{
    const {company,account,access}=await this.access(context,row.companyId!),attempt=await this.attempt(account,row.referenceId!),j=(row.resultJson??{}) as Journal;
    const manage=access.capabilities.includes(MANAGE),available=!row.leaseUntil||row.leaseUntil<=new Date(),own=context.userId===row.initiatorUserId;
    const issue=await this.prisma.client.billingIssue.findFirst({where:{...this.scope(),companyId:row.companyId,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id}});
    return {id:row.id,type:TYPE,state:row.state as BillingCheckoutExpiryOperation['state'],scope:{kind:'COMPANY',companyId:row.companyId!,mode:row.livemode?'LIVE':'TEST'},version:row.version,reason:row.reason,
      initiatorUserId:row.initiatorUserId,approverUserId:null,errorCode:row.errorCode,createdAt:row.createdAt.toISOString(),observedAt:row.observedAt?.toISOString()??null,expiresAt:row.expiresAt.toISOString(),referenceId:row.referenceId,
      companyName:company.name,previewHash:row.requestHash,dispatchedAt:j.dispatchedAt??null,providerState:j.providerState??null,paymentState:j.paymentState??null,reviewCaseId:issue?.id??null,
      reconciliationPending:!!j.providerState&&j.providerState!=='open'&&(account.activeAttemptId===attempt.id||!(['EXPIRED','COMPLETED'].includes(attempt.status)||j.providerState==='expired'&&attempt.status==='FAILED'&&(attempt.collectionJson as {aborted?:boolean}|null)?.aborted===true)),
      allowedActions:[...(own&&manage&&row.state==='PREVIEW'&&row.expiresAt>new Date()?['submit' as const]:[]),
        ...(manage&&available&&!j.dispatchedAt&&['PREVIEW','QUEUED','BLOCKED'].includes(row.state)?['cancel' as const]:[]),
        ...(manage&&available&&['QUEUED','RUNNING','UNKNOWN','BLOCKED'].includes(row.state)?['run' as const]:[])]};
  }
  async get(context:RequestContext,id:string){return this.view(context,await this.row(context,id));}
  async history(context:RequestContext,companyId:string,attemptId:string,cursor?:string){
    const {account}=await this.access(context,companyId);await this.attempt(account,attemptId);const anchor=cursor?await this.row(context,cursor):null;
    if(anchor&&(anchor.companyId!==companyId||anchor.referenceId!==attemptId))throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...this.scope(),companyId,type:TYPE,referenceId:attemptId,
      ...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    return {items:await Promise.all(rows.slice(0,25).map(row=>this.view(context,row))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  private audit(tx:Prisma.TransactionClient,row:BillingOperation,action:string,userId?:string){return tx.auditLog.create({data:{companyId:row.companyId,actorUserId:userId??null,...userId?{}:{actorType:'SERVICE',actorRefId:'billing-checkout-expiry-worker'},
    action:`billing.checkout_expiry.${action}`,targetType:'BillingOperation',targetId:row.id,requestId:row.id,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{attemptId:row.referenceId,version:row.version,state:row.state}}});}
  async command(context:RequestContext,id:string,action:'submit'|'cancel',version:number,hash:string,key?:string){
    if(action!=='submit'&&action!=='cancel'||!Number.isSafeInteger(version)||version<0||action==='submit'&&(!key||!/^[a-zA-Z0-9_-]{16,120}$/.test(key)))throw new BadRequestException();
    const before=await this.row(context,id),p=before.proposedJson as Proposed;
    const row=await this.prisma.client.$transaction(async tx=>{
      await this.lockCompanies(tx,before.companyId!,p.actorCompanyId);const row=await this.row(context,id,tx);this.valid(row);const {account}=await this.access(context,row.companyId!,MANAGE,tx);
      if(action==='submit'&&row.idempotencyKey===key&&row.requestHash===hash&&row.initiatorUserId===context.userId&&row.state!=='PREVIEW')return row;
      if(action==='cancel'&&row.state==='CANCELLED'&&row.requestHash===hash)return row;
      if(row.version!==version||row.requestHash!==hash||row.leaseUntil&&row.leaseUntil>new Date())throw stale();
      if(action==='submit'){
        if(row.initiatorUserId!==context.userId||row.state!=='PREVIEW'||row.expiresAt<=new Date()||checkoutExpiryBinding(account,await this.attempt(account,row.referenceId!,tx))!==p.sourceHash)throw stale();await this.actor(row,tx);
        const prior=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{...this.scope(),idempotencyKey:key!}}});if(prior)throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','คำขอต่างจากรายการเดิม');
        if(await tx.billingOperation.findFirst({where:{...this.scope(),companyId:row.companyId,type:TYPE,referenceId:row.referenceId,state:{in:['QUEUED','RUNNING','UNKNOWN','BLOCKED']}}}))throw billingError('CONTROL_OPERATION_IN_PROGRESS','มีคำขอเดิมที่ยังตรวจไม่จบ เปิดประวัติคำขอเดิมก่อน');
      }else if((row.resultJson as Journal|null)?.dispatchedAt||!['PREVIEW','QUEUED','BLOCKED'].includes(row.state))throw stale();
      const saved=await tx.billingOperation.update({where:{id},data:{state:action==='submit'?'QUEUED':'CANCELLED',...action==='submit'?{idempotencyKey:key}:{},version:{increment:1}}});
      if(action==='cancel')await resolveBillingIssue(tx,{...this.scope(),companyId:row.companyId,kind:'CONTROL_OPERATION_REVIEW',referenceId:id},'UNDISPATCHED_CHECKOUT_EXPIRY_CANCELLED');
      await this.audit(tx,saved,action,context.userId);return saved;
    });return this.view(context,row);
  }
  private async fence(tx:Prisma.TransactionClient,id:string,lease:string){
    const row=await tx.billingOperation.findUniqueOrThrow({where:{id}}),p=row.proposedJson as Proposed;this.valid(row);await this.lockCompanies(tx,row.companyId!,p.actorCompanyId);
    await tx.$queryRaw`SELECT id FROM "BillingAccount" WHERE id=${p.accountId} FOR UPDATE`;
    const account=await this.billing.account(row.companyId!,tx);if(!account||account.id!==p.accountId||row.state!=='RUNNING'||row.leaseToken!==lease||!row.leaseUntil||row.leaseUntil<=new Date()||
      account.leaseToken!==lease||!account.leaseUntil||account.leaseUntil<=new Date())throw stale();return {row,account,attempt:await this.attempt(account,row.referenceId!,tx)};
  }
  private async write(tx:Prisma.TransactionClient,row:BillingOperation,lease:string,data:Prisma.BillingOperationUpdateManyMutationInput){
    const changed=await tx.billingOperation.updateMany({where:{id:row.id,version:row.version,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data});if(!changed.count)throw stale();return tx.billingOperation.findUniqueOrThrow({where:{id:row.id}});
  }
  async run(context:RequestContext,id:string,version:number){const row=await this.row(context,id);await this.access(context,row.companyId!,MANAGE);if(row.version!==version||!(await this.view(context,row)).allowedActions.includes('run'))throw stale();await this.execute(row);return this.get(context,id);}
  private async execute(candidate:BillingOperation){
    const lease=randomUUID(),p=candidate.proposedJson as Proposed;this.valid(candidate);
    const claim=await this.prisma.client.$transaction(async tx=>{
      await this.lockCompanies(tx,candidate.companyId!,p.actorCompanyId);const row=await tx.billingOperation.findUniqueOrThrow({where:{id:candidate.id}}),account=await this.billing.account(candidate.companyId!,tx),now=new Date();this.valid(row);
      if(!account||account.id!==p.accountId||row.companyId!==candidate.companyId||row.requestHash!==candidate.requestHash||row.version!==candidate.version||!['QUEUED','RUNNING','UNKNOWN','BLOCKED'].includes(row.state)||row.leaseUntil&&row.leaseUntil>now)return null;
      const got=await tx.billingAccount.updateMany({where:{id:account.id,OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseToken:lease,leaseUntil:new Date(now.getTime()+120000)}});if(!got.count)return null;
      return tx.billingOperation.update({where:{id:row.id},data:{state:'RUNNING',leaseToken:lease,leaseUntil:new Date(now.getTime()+120000),version:{increment:1}}});
    });if(!claim)return;let observedTerminal=false;
    try{
      const account=await this.billing.account(claim.companyId!);if(!account||account.id!==p.accountId)throw stale();const attempt=await this.attempt(account,claim.referenceId!);
      if(binding(account,attempt)!==p.bindingHash||attempt.checkoutSessionId!==p.sessionId)throw stale();let observed=await readCheckoutExpiry(this.billing.stripe,account,attempt);
      if(observed.providerState==='open'){
        const journal=await this.prisma.client.$transaction(async tx=>{
          const {row,account,attempt}=await this.fence(tx,claim.id,lease);await this.actor(row,tx);const j=(row.resultJson??{}) as Journal,providerKey=`billing-checkout-expiry-${row.id}`;
          if(!observed.canExpire||row.expiresAt<=new Date()||checkoutExpiryBinding(account,attempt)!==p.sourceHash||j.dispatchedAt&&(j.providerKey!==providerKey||Date.now()-Date.parse(j.dispatchedAt)>=23*3600000))throw stale();
          const next={...j,dispatchedAt:j.dispatchedAt??new Date().toISOString(),providerKey};const saved=await this.write(tx,row,lease,{resultJson:json(next)});await this.audit(tx,saved,'dispatch');return next;
        });
        // A concurrent completion/expiry or lost response is decided by the original GET, never an error code.
        try{await this.billing.stripe.request('POST',`/checkout/sessions/${p.sessionId}/expire`,{},journal.providerKey);}catch(error){if(!(error instanceof StripeRequestError))throw error;}
        observed=await readCheckoutExpiry(this.billing.stripe,account,attempt);
      }
      if(observed.providerState==='open')throw billingError('CONTROL_CHECKOUT_OUTCOME_UNKNOWN','ยังยืนยันผลยุติหน้าชำระเดิมไม่ได้');
      await this.prisma.client.$transaction(async tx=>{
        const {row,account,attempt}=await this.fence(tx,claim.id,lease);if(binding(account,attempt)!==p.bindingHash)throw stale();
        const saved=await this.write(tx,row,lease,{state:'SUCCEEDED',resultJson:json({...row.resultJson as object,providerState:observed.providerState,paymentState:observed.paymentState}),observedAt:new Date(),errorCode:null,leaseToken:null,leaseUntil:null,version:{increment:1}});
        await tx.billingAccount.update({where:{id:account.id},data:{nextReconcileAt:new Date()}});
        await resolveBillingIssue(tx,{...this.scope(),companyId:row.companyId,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id},observed.providerState==='expired'?'ORIGINAL_CHECKOUT_EXPIRED':'ORIGINAL_CHECKOUT_COMPLETED');await this.audit(tx,saved,'observed');
      });observedTerminal=true;
    }catch(error){
      await this.prisma.client.$transaction(async tx=>{const {row}=await this.fence(tx,claim.id,lease),j=(row.resultJson??{}) as Journal;
        const saved=await this.write(tx,row,lease,{state:j.dispatchedAt?'UNKNOWN':'BLOCKED',errorCode:error instanceof ForbiddenException?'CONTROL_PERMISSION_CHANGED':'CONTROL_CHECKOUT_REVIEW',scheduledFor:new Date(Date.now()+300000),leaseToken:null,leaseUntil:null,version:{increment:1}});
        await detectBillingIssue(tx,{...this.scope(),companyId:row.companyId,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id});await this.audit(tx,saved,'review');});
    }finally{await this.prisma.client.billingAccount.updateMany({where:{id:p.accountId,leaseToken:lease},data:{leaseToken:null,leaseUntil:null}});}
    if(observedTerminal){try{await this.reconciler.reconcileAccount(p.accountId);}catch{await this.billing.issue(claim.companyId!,'RECONCILIATION_FAILED',p.accountId);}}
  }
  async drain(){
    if(!this.billing.stripe.enabled)return {processed:0,failed:0};const now=new Date();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...this.scope(),type:TYPE,state:{in:['QUEUED','RUNNING','UNKNOWN']},AND:[{OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},{OR:[{scheduledFor:null},{scheduledFor:{lte:now}}]}]},orderBy:{updatedAt:'asc'},take:5});
    let failed=0;for(const row of rows){try{await this.execute(row);}catch{failed++;}}return {processed:rows.length,failed};
  }
}
