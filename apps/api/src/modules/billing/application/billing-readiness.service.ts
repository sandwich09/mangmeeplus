import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingConfigurationCheck, BillingConfigurationCheckHistory, BillingConfigurationCheckItem, BillingPolicy } from '@watchdog-bms/contracts';
import { Prisma, type BillingOperation } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingService } from './billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService, configurationHash } from './billing-configuration.service';
import { inspectBillingConfiguration } from './billing-provider-configuration';
import { billingError } from '../domain/billing-policy';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

type Source={policy:BillingPolicy|null;gates:Record<string,boolean>;revisionId:string|null};
type Proposed={schemaVersion:1;source:Source;membershipId:string;actorCompanyId:string};
type Result={result:BillingConfigurationCheckItem['state'];items:BillingConfigurationCheckItem[];reviewCaseId:string|null};
const permission='system.billing.reconcile.run',type='CHECK_PROVIDER_CONFIGURATION';
const stale=()=>billingError('CONTROL_PREVIEW_STALE','การตั้งค่าเปลี่ยนแล้ว กรุณาตรวจใหม่');
const source=(s:Awaited<ReturnType<BillingService['settings']>>):Source=>({policy:s.policy,gates:s.gates,revisionId:s.settings.policyRevisionId});
@Injectable()
export class BillingReadinessService {
  constructor(private readonly prisma:PrismaService,private readonly billing:BillingService,private readonly admin:BillingAdminService,private readonly configuration:BillingConfigurationService){}
  private where(){return {type,companyId:null,stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode};}
  private async access(context:RequestContext,key='system.billing.read',tx:Prisma.TransactionClient=this.prisma.client){
    const access=await this.admin.access(context,key,tx);if(!access.platformScope)throw new ForbiddenException();return access;
  }
  private async row(context:RequestContext,id:string,tx:Prisma.TransactionClient=this.prisma.client){
    await this.access(context,'system.billing.read',tx);const row=await tx.billingOperation.findFirst({where:{...this.where(),id}});if(!row)throw new NotFoundException();return row;
  }
  private view(row:BillingOperation,s:Awaited<ReturnType<BillingService['settings']>>,canManage:boolean):BillingConfigurationCheck {
    const p=row.proposedJson as Proposed,result=row.resultJson as Result|null;
    const available=!row.leaseUntil||row.leaseUntil<=new Date();
    return {id:row.id,mode:row.livemode?'LIVE':'TEST',state:row.state as BillingConfigurationCheck['state'],version:row.version,sourceVersion:row.sourceVersion,
      isCurrent:row.sourceVersion===s.settings.version&&configurationHash(p.source)===configurationHash(source(s)),reason:row.reason,createdAt:row.createdAt.toISOString(),
      observedAt:row.observedAt?.toISOString()??null,errorCode:row.errorCode,reviewCaseId:result?.reviewCaseId??null,result:result?.result??null,items:result?.items??[],
      canRun:this.billing.stripe.enabled&&canManage&&['QUEUED','RUNNING'].includes(row.state)&&available,canCancel:canManage&&['QUEUED','BLOCKED'].includes(row.state)};
  }
  async get(context:RequestContext,id:string){const row=await this.row(context,id),access=await this.access(context);return this.view(row,await this.billing.settings(),access.capabilities.includes(permission));}
  async list(context:RequestContext,cursor?:string):Promise<BillingConfigurationCheckHistory>{
    const access=await this.access(context);if(!this.billing.stripe.enabled)return {items:[],nextCursor:null,activeCheck:null,canCreate:false,mode:'DISABLED',settingsVersion:0};
    const after=cursor?await this.row(context,cursor):null,s=await this.billing.settings();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...this.where(),...after?{OR:[{createdAt:{lt:after.createdAt}},{createdAt:after.createdAt,id:{lt:after.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    const active=await this.prisma.client.billingOperation.findFirst({where:{...this.where(),state:{in:['QUEUED','RUNNING']}}});
    const manage=access.capabilities.includes(permission);
    return {items:rows.slice(0,25).map(r=>this.view(r,s,manage)),nextCursor:rows.length>25?rows[24]!.id:null,activeCheck:active?this.view(active,s,manage):null,
      canCreate:manage&&!active,mode:this.billing.stripe.livemode?'LIVE':'TEST',settingsVersion:s.settings.version};
  }
  private async lock(tx:Prisma.TransactionClient){const s=await this.billing.settings(tx);await tx.$queryRaw`SELECT id FROM "BillingSettings" WHERE id=${s.settings.id} FOR UPDATE`;return this.billing.settings(tx);}
  private audit(tx:Prisma.TransactionClient,row:BillingOperation,action:string,context?:RequestContext){
    return tx.auditLog.create({data:{companyId:context?.companyId??null,actorUserId:context?.userId??null,actorType:context?'USER':'SERVICE',actorRefId:context?undefined:'billing-configuration-check',
      action:`billing.configuration_check.${action}`,targetType:'BillingOperation',targetId:row.id,requestId:context?.requestId??row.id,result:action==='blocked'?'FAILED':'SUCCESS',riskLevel:'MEDIUM',
      metadataJson:{hash:row.requestHash,sourceVersion:row.sourceVersion}}});
  }
  async create(context:RequestContext,input:{expectedVersion:number;reason:string},key:string){
    await this.access(context,permission);
    if(!this.billing.stripe.enabled)throw billingError('BILLING_NOT_CONFIGURED','ยังไม่เปิดการเชื่อมต่อ Stripe');
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||!/^[a-zA-Z0-9_-]{16,120}$/.test(key))throw new BadRequestException('Invalid configuration check');
    const hash=configurationHash([type,input.expectedVersion,input.reason.trim()]);
    const row=await this.prisma.client.$transaction(async tx=>{
      await this.access(context,permission,tx);const s=await this.lock(tx);
      const prior=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,idempotencyKey:key}}});
      if(prior){if(prior.type!==type||prior.initiatorUserId!==context.userId||prior.requestHash!==hash)throw stale();return prior;}
      if(s.settings.version!==input.expectedVersion)throw stale();
      if(await tx.billingOperation.count({where:{...this.where(),state:{in:['QUEUED','RUNNING']}}}))throw billingError('CONTROL_CONFIGURATION_CHECK_ACTIVE','มีรายการตรวจที่กำลังทำอยู่ เปิดรายการเดิมเพื่อดูผล');
      const p:Proposed={schemaVersion:1,source:source(s),membershipId:context.membershipId,actorCompanyId:context.companyId};
      const row=await tx.billingOperation.create({data:{...this.where(),state:'QUEUED',reason:input.reason.trim(),sourceVersion:s.settings.version,referenceId:s.settings.id,
        initiatorUserId:context.userId,idempotencyKey:key,requestHash:hash,expiresAt:new Date(),proposedJson:p as unknown as Prisma.InputJsonValue}});
      await this.audit(tx,row,'requested',context);return row;
    });return this.get(context,row.id);
  }
  private async execute(candidate:BillingOperation,caller?:RequestContext){
    const lease=randomUUID(),now=new Date();
    const claimed=await this.prisma.client.billingOperation.updateMany({where:{...this.where(),id:candidate.id,version:candidate.version,state:{in:['QUEUED','RUNNING']},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},
      data:{state:'RUNNING',leaseToken:lease,leaseUntil:new Date(now.getTime()+120000),version:{increment:1}}});
    if(!claimed.count)return null;
    try{
      const p=candidate.proposedJson as Proposed;
      if(p.schemaVersion!==1||candidate.requestHash!==configurationHash([type,candidate.sourceVersion,candidate.reason]))throw stale();
      await this.configuration.operationActor(candidate,candidate.initiatorUserId,p.membershipId,p.actorCompanyId,permission,this.prisma.client);
      if(caller)await this.access(caller,permission);
      const before=await this.billing.settings();
      if(candidate.sourceVersion!==before.settings.version||configurationHash(p.source)!==configurationHash(source(before)))throw stale();
      const items=await inspectBillingConfiguration(this.billing,p.source.policy);
      const result:Result['result']=items.some(i=>i.state==='DIFFERENT')?'DIFFERENT':items.some(i=>i.state==='UNAVAILABLE')?'UNAVAILABLE':items[0]?.state==='NOT_CONFIGURED'?'NOT_CONFIGURED':'MATCH';
      await this.prisma.client.$transaction(async tx=>{
        const companies=[...new Set([p.actorCompanyId,...caller?[caller.companyId]:[]])].sort();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id IN (${Prisma.join(companies)}) ORDER BY id FOR SHARE`);
        const s=await this.lock(tx),current=await tx.billingOperation.findFirst({where:{...this.where(),id:candidate.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}}});
        if(!current||current.sourceVersion!==s.settings.version||current.requestHash!==candidate.requestHash||configurationHash(current.proposedJson)!==configurationHash(p)||configurationHash(source(s))!==configurationHash(p.source))throw stale();
        await this.configuration.operationActor(current,current.initiatorUserId,p.membershipId,p.actorCompanyId,permission,tx);if(caller)await this.access(caller,permission,tx);
        const identity={companyId:null,stripeAccountId:current.stripeAccountId,livemode:current.livemode,kind:'CONFIGURATION_DRIFT',referenceId:s.settings.id};
        let reviewCaseId:string|null=null;
        if(result==='MATCH'){await resolveBillingIssue(tx,identity,'CURRENT_PROVIDER_CONFIGURATION_MATCHES');const issue=await tx.billingIssue.findFirst({where:identity});reviewCaseId=issue?.id??null;}
        else reviewCaseId=(await detectBillingIssue(tx,identity)).id;
        const changed=await tx.billingOperation.updateMany({where:{id:current.id,version:current.version,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:'SUCCEEDED',observedAt:new Date(),leaseToken:null,leaseUntil:null,version:{increment:1},resultJson:JSON.parse(JSON.stringify({result,items,reviewCaseId}))}});
        if(!changed.count)throw stale();await this.audit(tx,current,'observed',caller);
      });return true;
    }catch(error){
      await this.prisma.client.$transaction(async tx=>{const changed=await tx.billingOperation.updateMany({where:{id:candidate.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},
        data:{state:'BLOCKED',errorCode:error instanceof ForbiddenException?'CONTROL_PERMISSION_CHANGED':'CONTROL_CONFIGURATION_CHECK_REVIEW',leaseToken:null,leaseUntil:null,version:{increment:1}}});
        if(changed.count)await this.audit(tx,candidate,'blocked');});return false;
    }
  }
  async run(context:RequestContext,id:string,expectedVersion:number){
    const row=await this.row(context,id);await this.access(context,permission);
    if(row.state==='SUCCEEDED')return this.get(context,id);
    if(!this.billing.stripe.enabled||row.version!==expectedVersion||!['QUEUED','RUNNING'].includes(row.state)||(row.leaseUntil&&row.leaseUntil>new Date()))throw stale();
    await this.execute(row,context);return this.get(context,id);
  }
  async cancel(context:RequestContext,id:string,expectedVersion:number){
    await this.prisma.client.$transaction(async tx=>{await this.access(context,permission,tx);await this.lock(tx);const row=await this.row(context,id,tx);
      const changed=await tx.billingOperation.updateMany({where:{id,version:expectedVersion,state:{in:['QUEUED','BLOCKED']}},data:{state:'CANCELLED',version:{increment:1}}});
      if(!changed.count)throw stale();await this.audit(tx,row,'cancelled',context);});return this.get(context,id);
  }
  async drain(){
    if(!this.billing.stripe.enabled)return {processed:0,failed:0};
    const row=await this.prisma.client.billingOperation.findFirst({where:{...this.where(),state:{in:['QUEUED','RUNNING']},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:[{createdAt:'asc'},{id:'asc'}]});
    if(!row)return {processed:0,failed:0};const result=await this.execute(row);return {processed:result===true?1:0,failed:result===false?1:0};
  }
}
