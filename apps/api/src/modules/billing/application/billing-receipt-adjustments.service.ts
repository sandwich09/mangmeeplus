import { billingApprovalMode, canApproveBillingChange } from './billing-approval';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingReceiptReadWarning, BillingAdminReceiptGrant, BillingReceiptAdjustmentInput, BillingReceiptAdjustmentOperation, BillingReceiptAdjustments } from '@watchdog-bms/contracts';
import type { BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { bangkokMonthKey, resolvePlatformAiBudget } from '../../line-ai/application/company-ai-usage-meter';
import { readAiBudgetReadiness } from '../../line-ai/application/company-ai-budget-readiness';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { BillingService } from './billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { receiptQuotaSnapshot } from '../../line-ai/application/company-ocr-governance';
import { assertKeys, billingError, hashBilling, configurationHash } from '../domain/billing-policy';
import { receiptLots } from './billing-receipt-grants';

const types=['GRANT_RECEIPTS','REVOKE_RECEIPTS'];
const stale=()=>billingError('CONTROL_PREVIEW_STALE','ข้อมูลหรือวันหมดอายุเปลี่ยนแล้ว โหลดข้อมูลล่าสุดและตรวจใหม่');
const json=(value:unknown)=>value as Prisma.InputJsonValue;
type Proposed={accountId:string|null;membershipId:string;actorCompanyId:string;sourceHash:string;units:number;grantExpiresAt:string;
  beforeRemaining:number|null;grantId:string|null;grantSourceHash:string|null};
type Journal={requesterCredentialVersion?:string;approverCredentialVersion?:string;approvedAt?:string;observedRemaining?:number|null;grantId?:string};

@Injectable()
export class BillingReceiptAdjustmentsService {
  constructor(private readonly prisma:PrismaService,private readonly billing:BillingService,private readonly admin:BillingAdminService,
    private readonly configuration:BillingConfigurationService,private readonly config:AppConfigService){}
  private async readWarnings(companyId:string,tx:Prisma.TransactionClient):Promise<BillingReceiptReadWarning[]>{
    const monthKey=bangkokMonthKey(),configuration=await tx.companyAiConfiguration.findUnique({where:{companyId}});
    const reads=await tx.companyOcrMonthlyUsage.findUnique({where:{companyId_monthKey:{companyId,monthKey}}});
    const budget=configuration?.monthlyBudgetSatang??(await resolvePlatformAiBudget({client:tx} as PrismaService,this.config,true)).monthlyBudgetSatang;
    // §11.4/R-10: the SAME projection admission uses, so this preview cannot say receipts are
    // readable while a SPLIT company's OCR share is gone. Words only — no money reaches this list.
    // A policy we cannot read closes every scope, which surfaces here as AI_BUDGET_REACHED; the
    // exact reason is the red `invalidReason` notice on the partner AI budget page.
    const money=await readAiBudgetReadiness(tx,{companyId,monthKey,row:configuration,totalSatang:budget});
    return [...configuration?.ocrEnabled===false?['OCR_DISABLED' as const]:[],
      ...configuration?.ocrMonthlyLimit!=null&&(reads?.usedCount??0)>=configuration.ocrMonthlyLimit?['OCR_LIMIT_REACHED' as const]:[],
      ...money.total!=='OK'?['AI_BUDGET_REACHED' as const]:[],
      // Under SHARED `ocr` IS `total`, so this can never double up with the line above.
      ...money.total==='OK'&&money.ocr!=='OK'?['AI_OCR_BUDGET_REACHED' as const]:[],
      // Credit-wording spec §5.3: held credit is not spend yet, so the three lines above can all be
      // silent while the usable balance is already lower than this console shows. Appended last so a
      // company without holds keeps today's exact list. `reserved.TOTAL` is CHAT + OCR.
      ...money.reserved.TOTAL>0||money.unresolvedHolds>0?['AI_CREDIT_HOLDS_PENDING' as const]:[]];
  }
  private async scope(context:RequestContext,companyId:string,tx:Prisma.TransactionClient=this.prisma.client){
    const result=await this.admin.scopedCompany(context,companyId,tx);
    await this.admin.access(context,'system.billing.financial.read',tx);
    return result;
  }
  private async lock(tx:Prisma.TransactionClient,companyId:string){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${companyId}`}))`;
    await lockPlanTermCompany(tx,companyId);
  }
  private source(s:Awaited<ReturnType<BillingReceiptAdjustmentsService['scope']>>){
    const a=s.account,t=s.company.planTerm;
    return hashBilling([s.company.id,s.company.status,a?.id,a?.stripeAccountId,a?.livemode,a?.paidThrough,a?.baseSubscriptionId,
      a?.activeAttemptId,a?.activeCollectionOperationId,t?.tierKey,t?.billingReceiptAccountId,t?.termEndsAt,t?.termDisabledAt,t?.monthlySlipLimit,t?.warmupUntil,t?.warmupSlipLimit]);
  }
  private blocked(s:Awaited<ReturnType<BillingReceiptAdjustmentsService['scope']>>){
    const a=s.account,t=s.company.planTerm,now=new Date();
    if(!t||t.termEndsAt<=now)return 'CONTROL_RECEIPT_TERM_REQUIRED';
    if(t.billingReceiptAccountId&&(!a||t.billingReceiptAccountId!==a.id||!a.paidThrough||a.paidThrough<=now))
      return 'CONTROL_PAID_RECEIPTS_REQUIRED';
    if(s.company.status!=='ACTIVE'||t.termDisabledAt)return 'CONTROL_COMPANY_HELD';
    if(a?.activeAttemptId||a?.activeCollectionOperationId)return 'CONTROL_OPERATION_IN_PROGRESS';
    return null;
  }
  private maxExpiry(s:Awaited<ReturnType<BillingReceiptAdjustmentsService['scope']>>){
    const t=s.company.planTerm;if(!t)return null;
    return new Date(Math.min(t.termEndsAt.getTime(),t.billingReceiptAccountId?s.account?.paidThrough?.getTime()??0:Infinity));
  }
  private async remaining(tx:Prisma.TransactionClient,companyId:string){
    const q=await receiptQuotaSnapshot({client:tx} as PrismaService,companyId);
    return q.planLimit===null?null:Math.max(0,q.planLimit-q.usedCount);
  }
  private async grant(tx:Prisma.TransactionClient,companyId:string,accountId:string|null,id:string){
    const row=await tx.billingReceiptGrant.findFirst({where:{id,companyId,kind:'ADMIN_ADJUSTMENT',OR:[{billingAccountId:accountId},{billingAccountId:null}]}});
    if(!row)throw new NotFoundException();
    // Add-on plan PR B: the same ledger projection admission uses, not a count of admission rows.
    const [lot]=await receiptLots(tx,{id:row.id});return {...row,lot:lot!};
  }
  private grantView(row:Awaited<ReturnType<BillingReceiptAdjustmentsService['grant']>>):BillingAdminReceiptGrant {
    const active=!row.revokedAt&&row.availableAt<=new Date()&&row.expiresAt>new Date();
    return {id:row.id,units:row.units,used:row.lot.consumed+row.lot.reserved,remaining:active?row.lot.remaining:0,
      expiresAt:row.expiresAt.toISOString(),revokedAt:row.revokedAt?.toISOString()??null,active};
  }
  private async row(context:RequestContext,id:string,tx:Prisma.TransactionClient=this.prisma.client){
    const row=await tx.billingOperation.findFirst({where:{id,type:{in:types},stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode}});
    if(!row?.companyId)throw new NotFoundException();await this.scope(context,row.companyId,tx);return row;
  }
  private async view(context:RequestContext,row:BillingOperation,tx:Prisma.TransactionClient=this.prisma.client,warnings?:BillingReceiptReadWarning[]):Promise<BillingReceiptAdjustmentOperation>{
    const s=await this.scope(context,row.companyId!,tx),p=row.proposedJson as Proposed,j=(row.resultJson??{}) as Journal;
    const fresh=row.expiresAt>new Date(),own=row.initiatorUserId===context.userId;
    const manage=s.access.capabilities.includes('system.billing.override.manage'),approve=s.access.capabilities.includes('system.billing.approval.approve');
    const actors=await tx.user.findMany({where:{id:{in:[row.initiatorUserId,...row.approverUserId?[row.approverUserId]:[]]}},select:{id:true,displayName:true}});
    const grantId=j.grantId??p.grantId,grant=grantId?await this.grant(tx,row.companyId!,p.accountId,grantId):null;
    return {id:row.id,type:row.type as BillingReceiptAdjustmentOperation['type'],state:row.state as BillingReceiptAdjustmentOperation['state'],scope:{kind:'COMPANY',companyId:row.companyId!,mode:row.livemode?'LIVE':'TEST'},
      companyName:s.company.name,version:row.version,reason:row.reason,initiatorUserId:row.initiatorUserId,approverUserId:row.approverUserId,approvalMode:billingApprovalMode(row),errorCode:row.errorCode,
      createdAt:row.createdAt.toISOString(),observedAt:row.observedAt?.toISOString()??null,expiresAt:row.expiresAt.toISOString(),referenceId:row.referenceId,
      previewHash:row.requestHash,units:p.units,grantExpiresAt:p.grantExpiresAt,beforeRemaining:p.beforeRemaining,observedRemaining:j.observedRemaining??null,
      requesterName:actors.find(a=>a.id===row.initiatorUserId)?.displayName??null,approverName:actors.find(a=>a.id===row.approverUserId)?.displayName??null,
      grant:grant?this.grantView(grant):null,readWarnings:warnings??await this.readWarnings(row.companyId!,tx),allowedActions:[...(fresh&&own&&manage&&row.state==='PREVIEW'?['submit' as const]:[]),
        ...(fresh&&canApproveBillingChange(s.access,row.initiatorUserId,context.userId,'system.billing.override.manage')&&row.state==='AWAITING_APPROVAL'?['approve' as const]:[]),
        ...(['PREVIEW','AWAITING_APPROVAL'].includes(row.state)&&(manage||approve)?['cancel' as const]:[])]};
  }
  async get(context:RequestContext,id:string){return this.view(context,await this.row(context,id));}
  async list(context:RequestContext,companyId:string,cursor?:string):Promise<BillingReceiptAdjustments>{
    const s=await this.scope(context,companyId),anchor=cursor?await this.row(context,cursor):null;
    if(anchor&&anchor.companyId!==companyId)throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{companyId,type:{in:types},stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,
      ...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    const blockedReason=this.blocked(s),quota=await receiptQuotaSnapshot(this.prisma,companyId);
    const remaining=quota.planLimit===null?null:Math.max(0,quota.planLimit-quota.usedCount);
    const warnings=await this.readWarnings(companyId,this.prisma.client);
    return {companyId,companyName:s.company.name,sourceHash:this.source(s),paidThrough:s.account?.paidThrough?.toISOString()??null,maxGrantExpiresAt:this.maxExpiry(s)?.toISOString()??null,remaining,
      ...(quota.monthlyAllowance?{monthlyAllowance:quota.monthlyAllowance}:{}),
      canCreate:!blockedReason&&s.access.capabilities.includes('system.billing.override.manage'),blockedReason,readWarnings:warnings,
      items:await Promise.all(rows.slice(0,25).map(row=>this.view(context,row,this.prisma.client,warnings))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async preview(context:RequestContext,companyId:string,input:BillingReceiptAdjustmentInput){
    assertKeys(input,['type','units','expiresAt','grantId','sourceHash','reason']);
    if(!types.includes(input.type)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||
      typeof input.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceHash))throw new BadRequestException();
    const row=await this.prisma.client.$transaction(async tx=>{
      await this.lock(tx,companyId);const s=await this.scope(context,companyId,tx);await this.admin.access(context,'system.billing.override.manage',tx);
      const blocked=this.blocked(s);if(blocked)throw billingError(blocked,'ตรวจสถานะแพ็กเกจและรายการเดิมก่อนเพิ่มใบเสร็จ');
      if(this.source(s)!==input.sourceHash)throw stale();const accountId=s.company.planTerm!.billingReceiptAccountId,now=new Date();
      let units:number,expiry:Date,grantId:string|null=null,grantSourceHash:string|null=null;
      if(input.type==='GRANT_RECEIPTS'){
        if(input.grantId!==undefined||!Number.isSafeInteger(input.units)||input.units!<1||input.units!>2147483647||typeof input.expiresAt!=='string')throw new BadRequestException();
        units=input.units!;expiry=new Date(input.expiresAt);
        if(!Number.isFinite(expiry.getTime())||expiry.toISOString()!==input.expiresAt)throw new BadRequestException();
        if(expiry<=now||expiry>this.maxExpiry(s)!)throw stale();
      }else{
        if(input.units!==undefined||input.expiresAt!==undefined||typeof input.grantId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.grantId))throw new BadRequestException();
        const g=await this.grant(tx,companyId,accountId,input.grantId);if(g.revokedAt||g.expiresAt<=now)throw stale();
        units=g.units;expiry=g.expiresAt;grantId=g.id;grantSourceHash=g.sourceHash;
      }
      const remaining=await this.remaining(tx,companyId),id=randomUUID();
      const p:Proposed={accountId,membershipId:context.membershipId,actorCompanyId:context.companyId,sourceHash:input.sourceHash,units,
        grantExpiresAt:expiry.toISOString(),beforeRemaining:remaining,grantId,grantSourceHash};
      return tx.billingOperation.create({data:{id,companyId,stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,type:input.type,referenceId:grantId,
        proposedJson:json(p),sourceVersion:s.account?.version??0,reason:input.reason.trim(),initiatorUserId:context.userId,
        requestHash:configurationHash([id,input.type,p,input.reason.trim()]),expiresAt:new Date(now.getTime()+600000)}});
    });return this.view(context,row);
  }
  async command(context:RequestContext,id:string,action:'submit'|'approve'|'cancel',version:number,hash:string,key?:string){
    const original=await this.row(context,id);
    if(action==='submit'&&(!key||!/^[a-zA-Z0-9_-]{16,120}$/.test(key)))throw new BadRequestException();
    const row=await this.prisma.client.$transaction(async tx=>{
      await this.lock(tx,original.companyId!);const row=await this.row(context,id,tx),s=await this.scope(context,row.companyId!,tx);
      const p=row.proposedJson as Proposed,j=(row.resultJson??{}) as Journal;
      const permission=action==='approve'?'system.billing.approval.approve':'system.billing.override.manage';
      if(!s.access.capabilities.includes(permission)&&!(action==='cancel'&&s.access.capabilities.includes('system.billing.approval.approve')))throw new ForbiddenException();
      await this.configuration.requireProof(context,tx);
      if(row.requestHash!==hash||hash!==configurationHash([id,row.type,p,row.reason]))throw stale();
      if(action==='submit'){
        const replay=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:row.stripeAccountId,livemode:row.livemode,idempotencyKey:key!}}});
        if(replay&&(replay.id!==id||replay.initiatorUserId!==context.userId||replay.requestHash!==hash))throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','คำขอนี้ต่างจากรายการเดิม เปิดรายการเดิมเพื่อตรวจสอบ');
        if(row.idempotencyKey===key&&row.initiatorUserId===context.userId&&row.state!=='PREVIEW')return row;
      }
      if(action==='approve'&&row.state==='SUCCEEDED'&&row.approverUserId===context.userId)return row;
      if(action==='cancel'&&row.state==='CANCELLED')return row;
      if(row.version!==version||!['PREVIEW','AWAITING_APPROVAL'].includes(row.state))throw stale();
      let grantId=p.grantId,before:number|null=null,after:number|null=null;
      if(action!=='cancel'){
        if(row.expiresAt<=new Date()||this.source(s)!==p.sourceHash||this.blocked(s)||new Date(p.grantExpiresAt)<=new Date())throw stale();
        if(action==='submit'){
          if(row.initiatorUserId!==context.userId||row.state!=='PREVIEW')throw new ForbiddenException();
          j.requesterCredentialVersion=(await tx.userCredential.findUniqueOrThrow({where:{userId:context.userId}})).updatedAt.toISOString();
        }else{
          if(row.state!=='AWAITING_APPROVAL')throw new ForbiddenException();
          await this.configuration.requireApprovalActor(row,context,'system.billing.override.manage',tx);
          await this.configuration.operationActor(row,row.initiatorUserId,p.membershipId,p.actorCompanyId,'system.billing.override.manage',tx,row.companyId!);
          await tx.$queryRaw`SELECT "userId" FROM "UserCredential" WHERE "userId"=${row.initiatorUserId} FOR SHARE`;
          const credential=await tx.userCredential.findUnique({where:{userId:row.initiatorUserId}});
          if(!credential||credential.status!=='ACTIVE'||credential.mustChangePassword||(credential.expiresAt&&credential.expiresAt<=new Date())||credential.updatedAt.toISOString()!==j.requesterCredentialVersion)throw new ForbiddenException();
          // Fence the currently approving actor's scope and role assignments through commit as well.
          await this.configuration.operationActor(row,context.userId,context.membershipId,context.companyId,'system.billing.approval.approve',tx,row.companyId!);
          if(this.blocked(s)||new Date(p.grantExpiresAt)<=new Date())throw stale();
          await this.configuration.requireProof(context,tx);
          j.approverCredentialVersion=(await tx.userCredential.findUniqueOrThrow({where:{userId:context.userId}})).updatedAt.toISOString();j.approvedAt=new Date().toISOString();
          before=await this.remaining(tx,row.companyId!);
          if(row.type==='GRANT_RECEIPTS'){
            const now=new Date(),expiry=new Date(p.grantExpiresAt);
            const g=await tx.billingReceiptGrant.create({data:{companyId:row.companyId!,billingAccountId:p.accountId,sourceKey:row.id,sourceHash:row.requestHash,
              kind:'ADMIN_ADJUSTMENT',units:p.units,availableAt:now,serviceStart:now,serviceEnd:expiry,expiresAt:expiry,policyRevisionId:'ADMIN_APPROVED'}});grantId=g.id;
          }else{
            const g=await this.grant(tx,row.companyId!,p.accountId,p.grantId!);
            if(g.revokedAt||g.expiresAt<=new Date()||g.sourceHash!==p.grantSourceHash)throw stale();
            await tx.billingReceiptGrant.update({where:{id:g.id},data:{revokedAt:new Date()}});
          }
          after=await this.remaining(tx,row.companyId!);
          j.observedRemaining=after;j.grantId=grantId!;
        }
      }
      const updated=await tx.billingOperation.update({where:{id},data:{state:action==='submit'?'AWAITING_APPROVAL':action==='approve'?'SUCCEEDED':'CANCELLED',
        ...action==='submit'?{idempotencyKey:key}:{},...action==='approve'?{approverUserId:context.userId,observedAt:new Date()}:{},resultJson:json(j),version:{increment:1}}});
      await tx.auditLog.create({data:{companyId:row.companyId,actorUserId:context.userId,action:`billing.receipt_adjustment.${action}`,targetType:'BillingOperation',targetId:id,
        requestId:context.requestId,result:'SUCCESS',riskLevel:'CRITICAL',metadataJson:{source:'ADMIN_ADJUSTMENT',reason:row.reason,fromState:row.state,toState:updated.state,
          beforeRemaining:before,afterRemaining:after,requestedUnits:p.units,grantId,expiresAt:p.grantExpiresAt,initiatorUserId:row.initiatorUserId,approverUserId:updated.approverUserId,approvalMode:billingApprovalMode(updated)}}});
      return updated;
    });return this.view(context,row);
  }
}
