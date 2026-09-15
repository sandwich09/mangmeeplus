import type { AdminCollectionSource } from './billing-admin-collection';
import type { FreeDaySource } from './billing-free-days';
import { AppConfigService } from '../../../common/config/app-config.service';
import { bangkokMonthKey, resolvePlatformAiBudget } from '../../line-ai/application/company-ai-usage-meter';
import { paidReceiptBalance } from './billing-receipt-grants';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingPlanAdjustmentInput, BillingPlanAdjustmentOperation, BillingPlanAdjustments, BillingPlanAdjustmentUnchanged, CompanyPlanCapacity } from '@watchdog-bms/contracts';
import { Prisma, type BillingOperation, type BillingAccount } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { PLATFORM_SEAT_EXEMPT_ROLE } from '../../system-partner-management/application/plan-term-limit';
import { currentCapacityOverride, effectivePlanCapacity, type TemporaryPlanCapacity } from '../../system-partner-management/domain/logic/plan-capacity';
import { BillingService } from './billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { assertKeys, billingError, configurationHash, hashBilling } from '../domain/billing-policy';

const types=['GRANT_OVERRIDE','REVOKE_OVERRIDE','GRANT_FREE_DAYS','CHANGE_COLLECTION'];
const providerOperation=(type:string)=>['GRANT_FREE_DAYS','CHANGE_COLLECTION'].includes(type);
const managePermission=(type:string)=>type==='CHANGE_COLLECTION'?'system.billing.collection.manage':'system.billing.override.manage';
const stale=()=>billingError('CONTROL_PREVIEW_STALE','ข้อมูลแพ็กเกจหรือจำนวนผู้ใช้เปลี่ยนแล้ว โหลดข้อมูลล่าสุดและตรวจใหม่');
const json=(value:unknown)=>value as Prisma.InputJsonValue;
type Proposed={accountId:string;membershipId:string;actorCompanyId:string;sourceHash:string;before:CompanyPlanCapacity;after:CompanyPlanCapacity;
  collectionChange?:AdminCollectionSource;dayExtension?:FreeDaySource;overrideId:string|null;overrideExpiresAt:string|null;activeBranches:number;activeMembers:number};
type Journal={collectionControl?:{dispatchedAt?:string};requesterCredentialVersion?:string;approverCredentialVersion?:string;approverMembershipId?:string;approverCompanyId?:string;approvedAt?:string;freeDays?:{createAt?:string;updateAt?:string}};

@Injectable()
export class BillingPlanAdjustmentsService {
  constructor(private readonly prisma:PrismaService,private readonly billing:BillingService,private readonly admin:BillingAdminService,
    private readonly configuration:BillingConfigurationService,private readonly config:AppConfigService){}
  private async scope(context:RequestContext,companyId:string,tx:Prisma.TransactionClient=this.prisma.client){
    const s=await this.admin.scopedCompany(context,companyId,tx);
    await this.admin.access(context,'system.billing.financial.read',tx);
    const [activeBranches,activeMembers]=await Promise.all([
      tx.branch.count({where:{companyId,status:'ACTIVE'}}),
      tx.companyMembership.count({where:{companyId,status:'ACTIVE',roles:{none:{role:PLATFORM_SEAT_EXEMPT_ROLE}}}}),
    ]);
    return {...s,activeBranches,activeMembers};
  }
  private async unchanged(s:Awaited<ReturnType<BillingPlanAdjustmentsService['scope']>>,tx:Prisma.TransactionClient):Promise<BillingPlanAdjustmentUnchanged|null>{
    if(!s.account||!s.company.planTerm)return null;
    const monthKey=bangkokMonthKey(),c=await tx.companyAiConfiguration.findUnique({where:{companyId:s.company.id}});
    const spend=await tx.companyAiMonthlyUsage.findUnique({where:{companyId_monthKey:{companyId:s.company.id,monthKey}}});
    const budget=c?.monthlyBudgetSatang??(await resolvePlatformAiBudget({client:tx} as PrismaService,this.config,true)).monthlyBudgetSatang;
    return {remainingReceipts:(await paidReceiptBalance(tx,s.company.id,s.account.id)).remaining,termEndsAt:s.company.planTerm.termEndsAt.toISOString(),
      nextChargeAt:s.account.nextChargeAt?.toISOString()??null,ocrEnabled:c?.ocrEnabled!==false,ocrMonthlyLimit:c?.ocrMonthlyLimit??null,aiBudgetSatang:budget,aiUsedSatang:spend?.costSatang??0};
  }
  private source(s:Awaited<ReturnType<BillingPlanAdjustmentsService['scope']>>){
    const a=s.account,t=s.company.planTerm;
    return hashBilling([s.company.id,s.company.status,a?.id,a?.stripeAccountId,a?.livemode,a?.version,a?.paidThrough,a?.baseSubscriptionId,
      a?.activeAttemptId,a?.activeCollectionOperationId,a?.pendingPlanChangeId,t?.tierKey,t?.branchLimit,t?.employeeLimit,t?.monthlySlipLimit,
      t?.billingReceiptAccountId,t?.termEndsAt,t?.termDisabledAt,t?.capacityOverride,s.activeBranches,s.activeMembers]);
  }
  private blocked(s:Awaited<ReturnType<BillingPlanAdjustmentsService['scope']>>,collection=false){
    const a=s.account,t=s.company.planTerm,now=new Date();
    if(collection)return !a?.baseSubscriptionId||!t?'CONTROL_PAID_PLAN_REQUIRED':a.activeAttemptId||a.activeCollectionOperationId||(a.leaseUntil&&a.leaseUntil>now)?'CONTROL_OPERATION_IN_PROGRESS':null;
    if(!a||!t?.billingReceiptAccountId||t.billingReceiptAccountId!==a.id||!a.paidThrough||a.paidThrough<=now||t.termEndsAt<=now)return 'CONTROL_PAID_PLAN_REQUIRED';
    if(s.company.status!=='ACTIVE'||t.termDisabledAt)return 'CONTROL_COMPANY_HELD';
    if(a.activeAttemptId||a.activeCollectionOperationId||(a.leaseUntil&&a.leaseUntil>now))return 'CONTROL_OPERATION_IN_PROGRESS';
    return null;
  }
  private async row(context:RequestContext,id:string,tx:Prisma.TransactionClient=this.prisma.client){
    const row=await tx.billingOperation.findFirst({where:{id,type:{in:types},stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode}});
    if(!row?.companyId)throw new NotFoundException();await this.admin.scopedCompany(context,row.companyId,tx);return row;
  }
  private async view(context:RequestContext,row:BillingOperation,tx:Prisma.TransactionClient=this.prisma.client):Promise<BillingPlanAdjustmentOperation>{
    const s=await this.scope(context,row.companyId!,tx),p=row.proposedJson as unknown as Proposed;
    const fresh=row.expiresAt>new Date(),own=row.initiatorUserId===context.userId;
    const manage=s.access.capabilities.includes(managePermission(row.type)),approve=s.access.capabilities.includes('system.billing.approval.approve');
    const actors=await tx.user.findMany({where:{id:{in:[row.initiatorUserId,...row.approverUserId?[row.approverUserId]:[]]}},select:{id:true,displayName:true}});
    const unchanged=await this.unchanged(s,tx);
    await this.scope(context,row.companyId!,tx);
    return {id:row.id,type:row.type as BillingPlanAdjustmentOperation['type'],state:row.state as BillingPlanAdjustmentOperation['state'],scope:{kind:'COMPANY',companyId:row.companyId!,mode:row.livemode?'LIVE':'TEST'},
      companyName:s.company.name,version:row.version,reason:row.reason,initiatorUserId:row.initiatorUserId,approverUserId:row.approverUserId,errorCode:row.errorCode,
      createdAt:row.createdAt.toISOString(),observedAt:row.observedAt?.toISOString()??null,expiresAt:row.expiresAt.toISOString(),referenceId:row.referenceId,
      ...(p.collectionChange?{collectionChange:{action:p.collectionChange.action,before:p.collectionChange.before,after:p.collectionChange.after,openInvoices:p.collectionChange.openInvoices,draftInvoices:p.collectionChange.draftInvoices,outstandingSatang:p.collectionChange.outstandingSatang,paidThrough:p.collectionChange.paidThrough,graceEndsAt:p.collectionChange.graceEndsAt,cancelAtPeriodEnd:p.collectionChange.cancelAtPeriodEnd}}:{}),
      ...(p.dayExtension?{dayExtension:{days:p.dayExtension.days,before:p.dayExtension.before,after:p.dayExtension.after,nextChargeBefore:p.dayExtension.nextChargeBefore,nextChargeAfter:p.dayExtension.nextChargeAfter}}:{}),
      unchanged,previewHash:row.requestHash,before:p.before,after:p.after,overrideExpiresAt:p.overrideExpiresAt,activeBranches:p.activeBranches,activeMembers:p.activeMembers,
      requesterName:actors.find(a=>a.id===row.initiatorUserId)?.displayName??null,approverName:actors.find(a=>a.id===row.approverUserId)?.displayName??null,
      current:s.company.planTerm?effectivePlanCapacity(s.company.planTerm):null,
      allowedActions:[...(fresh&&own&&manage&&row.state==='PREVIEW'?['submit' as const]:[]),
        ...(fresh&&!own&&approve&&row.state==='AWAITING_APPROVAL'?['approve' as const]:[]),
        ...((['PREVIEW','AWAITING_APPROVAL'].includes(row.state)||(providerOperation(row.type)&&['QUEUED','BLOCKED'].includes(row.state)&&!(row.resultJson as Journal|null)?.freeDays?.createAt&&!(row.resultJson as Journal|null)?.freeDays?.updateAt&&!(row.resultJson as Journal|null)?.collectionControl?.dispatchedAt))&&(manage||approve)?['cancel' as const]:[])]};
  }
  async get(context:RequestContext,id:string){return this.view(context,await this.row(context,id));}
  async list(context:RequestContext,companyId:string,cursor?:string):Promise<BillingPlanAdjustments>{
    const s=await this.scope(context,companyId),anchor=cursor?await this.row(context,cursor):null;
    if(anchor&&anchor.companyId!==companyId)throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{companyId,type:{in:types},stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,
      ...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    const t=s.company.planTerm,blockedReason=this.blocked(s),items=await Promise.all(rows.slice(0,25).map(row=>this.view(context,row)));
    const unchanged=await this.unchanged(s,this.prisma.client);
    await this.scope(context,companyId);
    return {companyId,companyName:s.company.name,sourceHash:this.source(s),baseline:t?{tierKey:t.tierKey as CompanyPlanCapacity['tierKey'],branchLimit:t.branchLimit,employeeLimit:t.employeeLimit}:null,
      current:t?effectivePlanCapacity(t):null,activeBranches:s.activeBranches,activeMembers:s.activeMembers,
      maxExpiresAt:s.account?.paidThrough&&t?new Date(Math.min(s.account.paidThrough.getTime(),t.termEndsAt.getTime())).toISOString():null,
      collectionPause:s.account?.collectionPauseJson as BillingPlanAdjustments['collectionPause'],canManageCollection:!this.blocked(s,true)&&s.access.capabilities.includes('system.billing.collection.manage'),
      unchanged,canCreate:!blockedReason&&s.access.capabilities.includes('system.billing.override.manage'),blockedReason,items,nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async preview(context:RequestContext,companyId:string,input:BillingPlanAdjustmentInput){
    assertKeys(input,['type','collectionAction','resumesAt','days','tierKey','branchLimit','employeeLimit','expiresAt','overrideId','sourceHash','reason']);
    if(!types.includes(input.type)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||
      typeof input.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceHash))throw new BadRequestException();
    let dayExtension:FreeDaySource|undefined,collectionChange:AdminCollectionSource|undefined;
    if(input.type!=='CHANGE_COLLECTION'&&(input.collectionAction!==undefined||input.resumesAt!==undefined))throw new BadRequestException();
    if(input.type==='CHANGE_COLLECTION'){
      const initial=await this.scope(context,companyId);await this.admin.access(context,managePermission(input.type));
      if(!initial.account||['tierKey','branchLimit','employeeLimit','expiresAt','overrideId','days'].some(k=>input[k as keyof BillingPlanAdjustmentInput]!==undefined))throw new BadRequestException();
      collectionChange=await this.billing.adminCollection.source(initial.account,input.collectionAction!,input.resumesAt);
    }
    if(input.type==='GRANT_FREE_DAYS'){
      const initial=await this.scope(context,companyId);await this.admin.access(context,'system.billing.override.manage');
      if(!initial.account||['tierKey','branchLimit','employeeLimit','expiresAt','overrideId'].some(k=>input[k as keyof BillingPlanAdjustmentInput]!==undefined))throw new BadRequestException();
      dayExtension=await this.billing.freeDays.source(initial.account,input.days!);
    }else if(input.days!==undefined)throw new BadRequestException();
    const row=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,companyId);const s=await this.scope(context,companyId,tx);await this.admin.access(context,managePermission(input.type),tx);
      const blocked=this.blocked(s,input.type==='CHANGE_COLLECTION');if(blocked)throw billingError(blocked,'ตรวจสถานะแพ็กเกจและรายการเดิมก่อนปรับสิทธิ์');
      if(this.source(s)!==input.sourceHash)throw stale();const a=s.account!,t=s.company.planTerm!,now=new Date(),before=effectivePlanCapacity(t,now);
      const active=currentCapacityOverride(t,now);let after:CompanyPlanCapacity,expiry:string|null=null;
      if(collectionChange){after=before;}else if(dayExtension){if(a.paidThrough?.toISOString()!==dayExtension.before||a.termProjectionHash!==dayExtension.termHash)throw stale();after=before;}else if(input.type==='GRANT_OVERRIDE'){
        if(input.overrideId!==undefined||!['STARTER_249','BASIC_499','PRO_999'].includes(input.tierKey??'')||
          ![input.branchLimit,input.employeeLimit].every(n=>Number.isSafeInteger(n)&&n!>0&&n!<=2147483647)||typeof input.expiresAt!=='string')throw new BadRequestException();
        const end=new Date(input.expiresAt);
        if(!Number.isFinite(end.getTime())||end.toISOString()!==input.expiresAt)throw new BadRequestException();
        if(end<=now||end>a.paidThrough!||end>t.termEndsAt)throw stale();
        after={tierKey:input.tierKey!,branchLimit:input.branchLimit!,employeeLimit:input.employeeLimit!};expiry=input.expiresAt;
      }else{
        if(input.tierKey!==undefined||input.branchLimit!==undefined||input.employeeLimit!==undefined||input.expiresAt!==undefined||!active||input.overrideId!==active.operationId)throw stale();
        after={tierKey:t.tierKey as CompanyPlanCapacity['tierKey'],branchLimit:t.branchLimit,employeeLimit:t.employeeLimit};
      }
      const id=randomUUID(),p:Proposed={accountId:a.id,membershipId:context.membershipId,actorCompanyId:context.companyId,sourceHash:input.sourceHash,
        before,after,...dayExtension?{dayExtension}:{},...collectionChange?{collectionChange}:{},overrideId:active?.operationId??null,overrideExpiresAt:expiry,activeBranches:s.activeBranches,activeMembers:s.activeMembers};
      return tx.billingOperation.create({data:{id,companyId,stripeAccountId:a.stripeAccountId,livemode:a.livemode,type:input.type,referenceId:providerOperation(input.type)?null:p.overrideId,
        proposedJson:json(p),sourceVersion:a.version,reason:input.reason.trim(),initiatorUserId:context.userId,
        requestHash:configurationHash([id,input.type,p,input.reason.trim()]),expiresAt:new Date(now.getTime()+600000)}});
    });return this.view(context,row);
  }
  async command(context:RequestContext,id:string,action:'submit'|'approve'|'cancel',version:number,hash:string,key?:string){
    const original=await this.row(context,id);
    if(action==='submit'&&(!key||!/^[a-zA-Z0-9_-]{16,120}$/.test(key)))throw new BadRequestException();
    const row=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,original.companyId!);const row=await this.row(context,id,tx),s=await this.scope(context,row.companyId!,tx);
      const p=row.proposedJson as unknown as Proposed,j=(row.resultJson??{}) as Journal;
      const permission=action==='approve'?'system.billing.approval.approve':managePermission(row.type);
      if(!s.access.capabilities.includes(permission)&&!(action==='cancel'&&s.access.capabilities.includes('system.billing.approval.approve')))throw new ForbiddenException();
      await this.configuration.requireProof(context,tx);
      if(row.requestHash!==hash||hash!==configurationHash([id,row.type,p,row.reason]))throw stale();
      if(action==='submit'){
        const replay=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:row.stripeAccountId,livemode:row.livemode,idempotencyKey:key!}}});
        if(replay&&(replay.id!==id||replay.initiatorUserId!==context.userId||replay.requestHash!==hash))throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','คำขอนี้ต่างจากรายการเดิม เปิดรายการเดิมเพื่อตรวจสอบ');
        if(row.idempotencyKey===key&&row.initiatorUserId===context.userId&&row.state!=='PREVIEW')return row;
      }
      if(action==='approve'&&['QUEUED','RUNNING','UNKNOWN','BLOCKED','SUCCEEDED'].includes(row.state)&&row.approverUserId===context.userId)return row;
      if(action==='cancel'&&row.state==='CANCELLED')return row;
      if(row.version!==version||!['PREVIEW','AWAITING_APPROVAL',...(action==='cancel'&&providerOperation(row.type)?['QUEUED','BLOCKED']:[])].includes(row.state))throw stale();
      if(action==='cancel'&&providerOperation(row.type)){if(j.freeDays?.createAt||j.freeDays?.updateAt||j.collectionControl?.dispatchedAt||(s.account?.leaseUntil&&s.account.leaseUntil>new Date()))throw stale();await tx.billingAccount.updateMany({where:{id:p.accountId,activeCollectionOperationId:id},data:{activeCollectionOperationId:null,version:{increment:1}}});}
      if(action!=='cancel'){
        const valid=()=>row.expiresAt>new Date()&&this.source(s)===p.sourceHash&&!this.blocked(s,row.type==='CHANGE_COLLECTION')&&
          configurationHash(effectivePlanCapacity(s.company.planTerm!))===configurationHash(p.before)&&
          (p.collectionChange?(!p.collectionChange.after?.resumesAt||Date.parse(p.collectionChange.after.resumesAt)>Date.now()+60000):p.dayExtension?new Date(p.dayExtension.before).getTime()>Date.now()+60000:row.type==='GRANT_OVERRIDE'?new Date(p.overrideExpiresAt!)>new Date():currentCapacityOverride(s.company.planTerm!)?.operationId===p.overrideId);
        if(!valid())throw stale();
        if(action==='submit'){
          if(row.initiatorUserId!==context.userId||row.state!=='PREVIEW')throw new ForbiddenException();
          j.requesterCredentialVersion=(await tx.userCredential.findUniqueOrThrow({where:{userId:context.userId}})).updatedAt.toISOString();
        }else{
          if(row.initiatorUserId===context.userId||row.state!=='AWAITING_APPROVAL')throw new ForbiddenException();
          await this.configuration.operationActor(row,row.initiatorUserId,p.membershipId,p.actorCompanyId,managePermission(row.type),tx,row.companyId!);
          await tx.$queryRaw`SELECT "userId" FROM "UserCredential" WHERE "userId"=${row.initiatorUserId} FOR SHARE`;
          const credential=await tx.userCredential.findUnique({where:{userId:row.initiatorUserId}});
          if(!credential||credential.status!=='ACTIVE'||credential.mustChangePassword||(credential.expiresAt&&credential.expiresAt<=new Date())||credential.updatedAt.toISOString()!==j.requesterCredentialVersion)throw new ForbiddenException();
          await this.configuration.operationActor(row,context.userId,context.membershipId,context.companyId,'system.billing.approval.approve',tx,row.companyId!);
          await this.configuration.requireProof(context,tx);if(!valid())throw stale();
          j.approverCredentialVersion=(await tx.userCredential.findUniqueOrThrow({where:{userId:context.userId}})).updatedAt.toISOString();j.approvedAt=new Date().toISOString();j.approverMembershipId=context.membershipId;j.approverCompanyId=context.companyId;
          if(p.dayExtension||p.collectionChange){
            await tx.billingAccount.update({where:{id:p.accountId},data:{activeCollectionOperationId:id,nextReconcileAt:new Date(),version:{increment:1}}});
          }else{
          const override:TemporaryPlanCapacity|null=row.type==='GRANT_OVERRIDE'?{operationId:row.id,accountId:p.accountId,
            tierKey:p.after.tierKey as TemporaryPlanCapacity['tierKey'],branchLimit:p.after.branchLimit,employeeLimit:p.after.employeeLimit,
            effectiveAt:j.approvedAt,expiresAt:p.overrideExpiresAt!}:null;
          await tx.companyPlanTerm.update({where:{companyId:row.companyId!},data:{capacityOverride:override?json(override):Prisma.DbNull,updatedByUserId:context.userId}});
          }
        }
      }
      const updated=await tx.billingOperation.update({where:{id},data:{state:action==='submit'?'AWAITING_APPROVAL':action==='approve'?(providerOperation(row.type)?'QUEUED':'SUCCEEDED'):'CANCELLED',
        ...action==='submit'?{idempotencyKey:key}:{},...action==='approve'?{approverUserId:context.userId,...providerOperation(row.type)?{}:{observedAt:new Date()}}:{},resultJson:json(j),version:{increment:1}}});
      await tx.auditLog.create({data:{companyId:row.companyId,actorUserId:context.userId,action:`billing.plan_adjustment.${action}`,targetType:'BillingOperation',targetId:id,
        requestId:context.requestId,result:'SUCCESS',riskLevel:'CRITICAL',metadataJson:{source:'ADMIN_ADJUSTMENT',reason:row.reason,fromState:row.state,toState:updated.state,
          before:json(p.before),after:action==='approve'?json(p.after):null,previousOverrideId:p.overrideId,expiresAt:p.overrideExpiresAt,...p.dayExtension?{dayExtension:json(p.dayExtension)}:{},...p.collectionChange?{collectionChange:json(p.collectionChange)}:{},
          initiatorUserId:row.initiatorUserId,approverUserId:updated.approverUserId}}});
      return updated;
    });return this.view(context,row);
  }
  async advanceFreeDays(account:BillingAccount,lease:string){
    const row=await this.prisma.client.billingOperation.findFirstOrThrow({where:{id:account.activeCollectionOperationId!,type:{in:['GRANT_FREE_DAYS','CHANGE_COLLECTION']},companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode}});
    return (row.type==='CHANGE_COLLECTION'?this.billing.adminCollection:this.billing.freeDays).advance(account,row,lease,async(tx,current)=>{
      const p=current.proposedJson as unknown as Proposed,j=current.resultJson as Journal;
      if(!current.approverUserId||!j.approverMembershipId||!j.approverCompanyId)throw new ForbiddenException();
      for(const actor of [{id:current.initiatorUserId,member:p.membershipId,company:p.actorCompanyId,permission:managePermission(current.type),credential:j.requesterCredentialVersion},
        {id:current.approverUserId,member:j.approverMembershipId,company:j.approverCompanyId,permission:'system.billing.approval.approve',credential:j.approverCredentialVersion}]){
        await this.configuration.operationActor(current,actor.id,actor.member,actor.company,actor.permission,tx,account.companyId);
        const credential=await tx.userCredential.findUnique({where:{userId:actor.id}});
        if(!credential||credential.status!=='ACTIVE'||credential.mustChangePassword||credential.updatedAt.toISOString()!==actor.credential||(credential.expiresAt&&credential.expiresAt<=new Date()))throw new ForbiddenException();
      }
    });
  }

}
