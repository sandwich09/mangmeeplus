import {BadRequestException,Injectable,NotFoundException} from '@nestjs/common';
import {randomUUID,createHash} from 'node:crypto';
import type {BillingOperation,Prisma} from '../../../generated/prisma/client';
import type {BillingBatchView} from '@watchdog-bms/contracts';
import type {RequestContext} from '../../auth/domain/models/request-context.model';
import {PrismaService} from '../../../common/database/prisma.service';
import {safeCsvCell} from '../../../common/export/csv.logic';
import {BillingAdminService} from './billing-admin.service';
import {BillingService} from './billing.service';
import {billingError,hashBilling} from '../domain/billing-policy';
import {billingRepairTypes,lockReconcileAuthority,reconcileBatchInput,reconcileCommandData} from './billing-reconcile-command';
const TYPE='BULK_RECONCILE',READ='system.billing.read',RUN='system.billing.reconcile.run';
const stale=()=>billingError('CONTROL_PREVIEW_STALE','ข้อมูลบริษัทหรือคำขอเปลี่ยน โหลดข้อมูลล่าสุดแล้วตรวจใหม่');
const json=(v:unknown)=>v as Prisma.InputJsonValue;
type Proposed={membershipId:string;actorCompanyId:string;items:{companyId:string;accountId:string;version:number;childId:string}[]};
const batchHash=(id:string,p:Proposed,reason:string)=>hashBilling([TYPE,id,p.membershipId,p.actorCompanyId,p.items.map(i=>[i.companyId,i.accountId,i.version,i.childId]),reason]);

/** Retained selection and child outcomes. Existing single-command workers execute each company. */
@Injectable()
export class BillingBatchesService{
  constructor(private readonly prisma:PrismaService,private readonly admin:BillingAdminService,private readonly billing:BillingService){}
  private scope(){return {stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode};}
  private valid(row:BillingOperation){const p=row.proposedJson as Proposed;
    if(row.type!==TYPE||row.companyId!==null||row.stripeAccountId!==this.billing.stripe.accountId||row.livemode!==this.billing.stripe.livemode||
      !p||typeof p.membershipId!=='string'||typeof p.actorCompanyId!=='string'||!Array.isArray(p.items)||p.items.length<1||p.items.length>25||
      p.items.some(i=>!i||typeof i.companyId!=='string'||typeof i.accountId!=='string'||typeof i.childId!=='string'||!Number.isSafeInteger(i.version)||i.version<0)||
      new Set(p.items.map(i=>i.companyId)).size!==p.items.length||new Set(p.items.map(i=>i.childId)).size!==p.items.length||row.requestHash!==batchHash(row.id,p,row.reason))throw stale();return p;
  }
  private async sources(context:RequestContext,p:Proposed,key=READ,tx:Prisma.TransactionClient=this.prisma.client){
    const access=await this.admin.access(context,key,tx);if(key!==READ)await this.admin.access(context,READ,tx);
    if(!access.platformScope&&p.items.some(i=>!access.companyIds.includes(i.companyId)))throw new NotFoundException();
    const companies=await tx.company.findMany({where:{id:{in:p.items.map(i=>i.companyId)}},select:{id:true,name:true}}),accounts=await tx.billingAccount.findMany({where:{id:{in:p.items.map(i=>i.accountId)},...this.scope()}});
    const items=p.items.map(item=>{const company=companies.find(c=>c.id===item.companyId),account=accounts.find(a=>a.id===item.accountId&&a.companyId===item.companyId);if(!company||!account)throw new NotFoundException();return {...item,company,account};});
    return {items,access};
  }
  private async row(context:RequestContext,id:string,tx:Prisma.TransactionClient=this.prisma.client){
    const row=await tx.billingOperation.findFirst({where:{id,type:TYPE,companyId:null,...this.scope()}});if(!row)throw new NotFoundException();await this.sources(context,this.valid(row),READ,tx);return row;
  }
  private async lock(tx:Prisma.TransactionClient,context:RequestContext,p:Proposed){
    await lockReconcileAuthority(tx,context,p.items.map(i=>i.companyId));
  }
  private audit(tx:Prisma.TransactionClient,context:RequestContext,row:BillingOperation,action:string,metadata:Prisma.InputJsonObject={}){
    return tx.auditLog.create({data:{companyId:null,actorUserId:context.userId,action:`billing.batch.${action}`,targetType:'BillingOperation',targetId:row.id,
      requestId:context.requestId,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{version:row.version,mode:row.livemode?'LIVE':'TEST',...metadata}}});
  }
  async preview(context:RequestContext,input:unknown){
    const value=reconcileBatchInput(input),p:Proposed={membershipId:context.membershipId,actorCompanyId:context.companyId,items:[]};
    if(!this.billing.stripe.enabled)throw billingError('CONTROL_POLICY_NOT_READY','ยังไม่พร้อมตรวจ Stripe ติดต่อผู้ดูแลการเชื่อมต่อ');
    await this.admin.access(context,RUN);
    for(const selected of value.companies){const source=await this.admin.scopedCompany(context,selected.companyId);if(!source.account||source.account.version!==selected.expectedVersion)throw stale();p.items.push({companyId:selected.companyId,accountId:source.account.id,version:source.account.version,childId:randomUUID()});}
    const id=randomUUID(),row=await this.prisma.client.$transaction(async tx=>{
      await this.lock(tx,context,p);const current=await this.sources(context,p,RUN,tx);if(current.items.some(i=>i.account!.version!==i.version))throw stale();
      return tx.billingOperation.create({data:{id,...this.scope(),companyId:null,type:TYPE,state:'PREVIEW',proposedJson:json(p),sourceVersion:0,reason:value.reason,initiatorUserId:context.userId,
        requestHash:batchHash(id,p,value.reason),expiresAt:new Date(Date.now()+600000)}});
    });return this.view(context,row);
  }
  private async view(context:RequestContext,row:BillingOperation):Promise<BillingBatchView>{
    const p=this.valid(row),source=await this.sources(context,p),ids=p.items.map(i=>i.childId);
    const children=await this.prisma.client.billingOperation.findMany({where:{id:{in:ids},...this.scope(),type:'RECONCILE'}});
    const issues=await this.prisma.client.billingIssue.findMany({where:{...this.scope(),kind:'CONTROL_OPERATION_REVIEW',referenceId:{in:ids}}});
    const items=source.items.map(i=>{const child=children.find(c=>c.id===i.childId&&c.companyId===i.companyId&&c.initiatorUserId===row.initiatorUserId&&c.sourceVersion===i.version&&
      (c.proposedJson as Proposed&{accountId:string}).accountId===i.accountId&&(c.proposedJson as Proposed).membershipId===p.membershipId&&(c.proposedJson as Proposed).actorCompanyId===p.actorCompanyId&&
      c.requestHash===hashBilling(['RECONCILE',i.accountId,i.version,row.reason,{accountId:i.accountId,membershipId:p.membershipId,actorCompanyId:p.actorCompanyId},null])),result=child?.resultJson as {pendingAttemptId?:string;issueCount?:number}|null;
      return {companyId:i.companyId,companyName:i.company.name,operationId:child?.id??null,state:child?.state??(row.state==='PREVIEW'?'PREVIEW':row.state==='CANCELLED'?'CANCELLED':'MISSING'),observedAt:child?.observedAt?.toISOString()??null,
        reviewCaseId:issues.find(issue=>issue.companyId===i.companyId&&issue.referenceId===child?.id)?.id??null,pendingAttempt:child?.observedAt&&result&&Object.hasOwn(result,'pendingAttemptId')?!!result.pendingAttemptId:null,issueCount:Number.isSafeInteger(result?.issueCount)?result!.issueCount!:null};});
    const preview=row.state==='PREVIEW',checked=items.filter(i=>i.state==='SUCCEEDED').length,pending=items.filter(i=>['QUEUED','RUNNING'].includes(i.state)).length,stopped=items.filter(i=>i.state==='CANCELLED').length,review=preview?0:items.length-checked-pending-stopped;
    const own=row.initiatorUserId===context.userId,current=await this.sources(context,p),manage=current.access.capabilities.includes(RUN);
    return {id:row.id,version:row.version,previewHash:row.requestHash,state:row.state,mode:row.livemode?'LIVE':'TEST',reason:row.reason,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),
      progress:preview?'PREVIEW':review?'REVIEW':pending?'PENDING':checked?(stopped?'PARTIAL':'CHECKED'):'STOPPED',checked,pending,review,stopped,
      canSubmit:own&&manage&&preview&&row.expiresAt>new Date(),canCancel:own&&manage&&(preview||items.some(i=>i.state==='QUEUED')),canExport:current.access.capabilities.includes('system.billing.export'),items};
  }
  async get(context:RequestContext,id:string){return this.view(context,await this.row(context,id));}
  async list(context:RequestContext,cursor?:string){
    const access=await this.admin.access(context,READ),where={...this.scope(),type:TYPE,companyId:null,...access.platformScope?{}:{initiatorUserId:context.userId}};
    const anchor=cursor?await this.prisma.client.billingOperation.findFirst({where:{...where,id:cursor}}):null;if(cursor&&!anchor)throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...where,...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26}),items:BillingBatchView[]=[];
    for(const row of rows.slice(0,25)){try{items.push(await this.view(context,row));}catch(error){if(!(error instanceof NotFoundException))throw error;}}
    return {items,nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async submit(context:RequestContext,id:string,version:number,hash:string,key:string){
    if(!Number.isSafeInteger(version)||version<0||!/^[a-zA-Z0-9_-]{16,120}$/.test(key))throw new BadRequestException();
    const before=await this.row(context,id),p=this.valid(before);
    const saved=await this.prisma.client.$transaction(async tx=>{
      await this.lock(tx,context,p);const row=await this.row(context,id,tx);await this.sources(context,p,RUN,tx);
      const prior=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{...this.scope(),idempotencyKey:key}}});
      if(prior){if(prior.id!==id||prior.requestHash!==hash||prior.initiatorUserId!==context.userId)throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','คำขอต่างจากรายการเดิม');return prior;}
      if(row.state!=='PREVIEW'||row.version!==version||row.requestHash!==hash||row.initiatorUserId!==context.userId||row.expiresAt<=new Date())throw stale();
      const sources=await this.sources(context,p,RUN,tx);if(sources.items.some(i=>i.account!.version!==i.version))throw stale();
      for(const item of sources.items){
        if(await tx.billingOperation.findFirst({where:{...this.scope(),companyId:item.companyId,type:{in:billingRepairTypes},state:{in:['QUEUED','RUNNING','UNKNOWN']}}}))throw billingError('CONTROL_OPERATION_IN_PROGRESS','มีบริษัทที่ยังมีคำขอเดิมค้างอยู่ เปิดรายการบริษัทแล้วตรวจคำขอเดิม');
        const child=await tx.billingOperation.create({data:{...reconcileCommandData(context,item.account!,row.reason),id:item.childId,state:'QUEUED',idempotencyKey:`batch-${id}-${item.childId}`}});
        await tx.auditLog.create({data:{companyId:item.companyId,actorUserId:context.userId,action:'billing.operation.queued',targetType:'BillingOperation',targetId:child.id,requestId:context.requestId,
          result:'SUCCESS',riskLevel:'HIGH',metadataJson:{before:'PREVIEW',after:'QUEUED',type:'RECONCILE',sourceVersion:item.version,batchId:id,reason:row.reason,mode:row.livemode?'LIVE':'TEST'}}});
      }
      const changed=await tx.billingOperation.updateMany({where:{id,state:'PREVIEW',version},data:{state:'QUEUED',idempotencyKey:key,version:{increment:1}}});if(changed.count!==1)throw stale();
      const saved=await tx.billingOperation.findUniqueOrThrow({where:{id}});await this.audit(tx,context,saved,'queued',{companies:p.items.length});return saved;
    });return this.view(context,saved);
  }
  async cancel(context:RequestContext,id:string,version:number){
    if(!Number.isSafeInteger(version)||version<0)throw new BadRequestException();const before=await this.row(context,id),p=this.valid(before);
    const saved=await this.prisma.client.$transaction(async tx=>{
      await this.lock(tx,context,p);const row=await this.row(context,id,tx);await this.sources(context,p,RUN,tx);if(row.initiatorUserId!==context.userId||row.version!==version||row.requestHash!==before.requestHash)throw stale();
      let count=0;for(const item of p.items){const child=await tx.billingOperation.findFirst({where:{id:item.childId,companyId:item.companyId,...this.scope(),type:'RECONCILE',state:'QUEUED',initiatorUserId:context.userId}});if(!child)continue;
        const changed=await tx.billingOperation.updateMany({where:{id:child.id,state:'QUEUED',version:child.version,OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{state:'CANCELLED',version:{increment:1},leaseToken:null,leaseUntil:null,errorCode:null}});
        if(changed.count){count++;await tx.auditLog.create({data:{companyId:item.companyId,actorUserId:context.userId,action:'billing.operation.cancel',targetType:'BillingOperation',targetId:child.id,requestId:context.requestId,
          result:'SUCCESS',riskLevel:'HIGH',metadataJson:{before:'QUEUED',after:'CANCELLED',batchId:id,type:'RECONCILE',reason:child.reason,sourceVersion:child.sourceVersion,mode:child.livemode?'LIVE':'TEST'}}});}}
      if(!count&&row.state!=='PREVIEW')return row;
      const saved=await tx.billingOperation.update({where:{id},data:{...row.state==='PREVIEW'?{state:'CANCELLED'}:{},version:{increment:1}}});await this.audit(tx,context,saved,'cancel_queued',{cancelled:count});return saved;
    });return this.view(context,saved);
  }
  async export(context:RequestContext,id:string){
    const row=await this.row(context,id),p=this.valid(row);await this.sources(context,p,'system.billing.export');const view=await this.view(context,row),at=new Date().toISOString();
    const labels:Record<string,string>={PREVIEW:'ยังไม่ส่งคำขอ',QUEUED:'รอตรวจ',RUNNING:'กำลังตรวจ',SUCCEEDED:'ตรวจแล้ว',UNKNOWN:'ยังยืนยันผลไม่ได้',BLOCKED:'ต้องตรวจเงื่อนไข',FAILED:'ตรวจไม่สำเร็จ',CANCELLED:'หยุดคำขอแล้ว',MISSING:'ไม่พบคำขอเดิม'};
    const csv='\uFEFF'+[['บริษัท','เลขบริษัท','สถานะคำขอ','เลขคำขอ','ตรวจเมื่อ (UTC)','ยังมีรายการซื้อค้าง','เคสที่ยังต้องตรวจ','ส่งออกเมื่อ (UTC)'],...view.items.map(i=>[i.companyName,i.companyId,Object.hasOwn(labels,i.state)?labels[i.state]:'ต้องตรวจสอบ',i.operationId,i.observedAt,i.pendingAttempt===null?'ยังไม่มีผลตรวจ':i.pendingAttempt?'มี':'ไม่พบจากผลคำขอนี้',i.issueCount,at])].map(r=>r.map(safeCsvCell).join(',')).join('\r\n')+'\r\n';
    const sha256=createHash('sha256').update(csv).digest('hex');await this.prisma.client.$transaction(async tx=>{await this.lock(tx,context,p);await this.sources(context,p,'system.billing.export',tx);await this.audit(tx,context,row,'exported',{rows:view.items.length,sha256});});
    return {csv,sha256,rowCount:view.items.length,exportedAt:at,fileName:`mangmee-billing-batch-${at.replace(/[:.Z]/g,'')}.csv`};
  }
}
