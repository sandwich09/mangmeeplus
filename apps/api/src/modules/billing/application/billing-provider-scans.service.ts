import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STRIPE_API_VERSION, type BillingProviderScanView, type BillingInvoiceFinding, type BillingScanScheduleInput, type BillingScanScheduleOperation, type BillingScanSchedule } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { StripeClient, StripeRequestError, type StripeObject, stripeId } from '../infrastructure/stripe.client';
import { billingError, hashBilling } from '../domain/billing-policy';
import { BillingConfigurationService } from './billing-configuration.service';
import { BillingAdminService } from './billing-admin.service';
import { BILLING_STRIPE_EVENTS, validBillingEvent } from './billing-reconciler.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

const SCHEDULE='CONFIGURE_PROVIDER_SCANS';
const SCHEDULE_DEFAULTS={enabled:false,intervalHours:24,initialLookbackHours:48};
type ScheduleConfig=typeof SCHEDULE_DEFAULTS;
type ScheduleSource=ScheduleConfig & {membershipId:string;actorCompanyId:string};
function scheduleConfig(value:unknown):ScheduleConfig|null {
  const input=value as ScheduleConfig|null;
  return input&&typeof input.enabled==='boolean'&&Number.isInteger(input.intervalHours)&&input.intervalHours>=1&&input.intervalHours<=168&&
    Number.isInteger(input.initialLookbackHours)&&input.initialLookbackHours>=1&&input.initialLookbackHours<=672?{enabled:input.enabled,intervalHours:input.intervalHours,initialLookbackHours:input.initialLookbackHours}:null;
}
const INVOICES='SCAN_PROVIDER_INVOICES',FINDING='OBSERVE_PROVIDER_INVOICE';
const TYPE = 'SCAN_PROVIDER_EVENTS', RUN = 'system.billing.reconcile.run';
type Source = { since: number; until: number; membershipId: string; actorCompanyId: string; scheduleId?:string;accountId?:string;customerId?:string };
type Progress = { cursor: string | null; pages: number; seen: number; imported: number; known: number; ignored: number; incompatible: number; failures: number; retryAt: string | null;missing?:number };
type InvoiceObservation={accountId:string;customerId:string;providerInvoiceId:string;created:number;status:string;currency:string;total:number;paid:number;classification:BillingInvoiceFinding['classification']};
const empty = (): Progress => ({ cursor: null, pages: 0, seen: 0, imported: 0, known: 0, ignored: 0, incompatible: 0, failures: 0, retryAt: null });
const invoiceWindow=(source:Source)=>Number.isSafeInteger(source.since)&&Number.isSafeInteger(source.until)&&source.since>=0&&source.since<source.until&&source.until<=Math.floor(Date.now()/1000)-60;
const windowOpen = (source: Source) => source.since >= Math.floor(Date.now() / 1000) - 29 * 86400;

@Injectable()
export class BillingProviderScansService {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient, private readonly admin: BillingAdminService, private readonly configuration:BillingConfigurationService) {}

  private scope(companyId?:string) { return { type: companyId?INVOICES:TYPE, companyId: companyId??null, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode }; }
  private admissionScope() {return {stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,type:{in:[TYPE,INVOICES]}};}
  private scheduleScope() { return {...this.scope(),type:SCHEDULE}; }
  private lock(tx:Prisma.TransactionClient) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-discovery:${this.stripe.accountId}:${this.stripe.livemode}`},0))`;
  }
  private publication(tx:Prisma.TransactionClient=this.prisma.client) {
    return tx.billingOperation.findFirst({where:{...this.scheduleScope(),state:'SUCCEEDED'},orderBy:[{sourceVersion:'desc'},{id:'desc'}]});
  }
  private automatic(tx:Prisma.TransactionClient=this.prisma.client,state?:string) {
    return tx.billingOperation.findFirst({where:{...this.scope(),sourceVersion:{gt:0},...(state?{state}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  }
  private scheduleView(row:BillingOperation,revision:number,actorId:string,canManage:boolean):BillingScanScheduleOperation {
    const config=scheduleConfig(row.proposedJson);
    return {id:row.id,mode:row.livemode?'LIVE':'TEST',state:row.state as BillingScanScheduleOperation['state'],version:row.version,sourceRevision:row.sourceVersion,
      previewHash:row.requestHash,...(config??SCHEDULE_DEFAULTS),reason:row.reason,initiatorUserId:row.initiatorUserId,createdAt:row.createdAt.toISOString(),
      expiresAt:row.expiresAt.toISOString(),publishedAt:row.observedAt?.toISOString()??null,
      canPublish:Boolean(config)&&this.stripe.enabled&&canManage&&actorId===row.initiatorUserId&&row.state==='PREVIEW'&&row.expiresAt>new Date()&&row.sourceVersion===revision,
      canCancel:canManage&&actorId===row.initiatorUserId&&row.state==='PREVIEW'};
  }
  private async scheduleRow(id:string,tx:Prisma.TransactionClient=this.prisma.client) {
    const row=await tx.billingOperation.findFirst({where:{...this.scheduleScope(),id}});
    if(!row)throw new NotFoundException();return row;
  }
  private nextDue(publication:BillingOperation,config:ScheduleConfig,last:BillingOperation|null) {
    return last&&(last.proposedJson as Source).scheduleId===publication.id?new Date(last.createdAt.getTime()+config.intervalHours*3600000):publication.observedAt??publication.createdAt;
  }
  async schedule(context:RequestContext):Promise<BillingScanSchedule> {
    const access=await this.authorize(context,'system.billing.read'),publication=await this.publication();
    const [last,completed]=await Promise.all([this.automatic(),this.automatic(this.prisma.client,'SUCCEEDED')]);
    const config=publication?scheduleConfig(publication.proposedJson):SCHEDULE_DEFAULTS;
    let blockedReason=!this.stripe.enabled?'BILLING_NOT_CONFIGURED':!config?'CONTROL_SCHEDULE_INVALID':null;
    if(publication&&config?.enabled&&!blockedReason){
      try{await this.admin.authorizeOperation(publication,RUN);}catch{blockedReason='CONTROL_PERMISSION_CHANGED';}
      if(!blockedReason&&last&&!['SUCCEEDED','CANCELLED'].includes(last.state))blockedReason='CONTROL_SCAN_PENDING';
    }
    return {mode:this.stripe.enabled?(this.stripe.livemode?'LIVE':'TEST'):'DISABLED',revision:publication?publication.sourceVersion+1:0,
      publicationId:publication?.id??null,ownerUserId:publication?.initiatorUserId??null,...(config??SCHEDULE_DEFAULTS),
      canManage:this.stripe.enabled&&access.capabilities.includes(RUN),blockedReason,
      nextDueAt:publication&&config?.enabled&&!blockedReason?this.nextDue(publication,config,last).toISOString():null,
      lastRun:last?this.view(last,access.capabilities.includes(RUN),context.userId):null,
      lastCompletedWindowEnd:completed?new Date((completed.proposedJson as Source).until*1000).toISOString():null};
  }
  async scheduleHistory(context:RequestContext,cursor?:string) {
    const access=await this.authorize(context,'system.billing.read'),publication=await this.publication();
    const anchor=cursor?await this.scheduleRow(cursor):null;
    const rows=await this.prisma.client.billingOperation.findMany({where:{...this.scheduleScope(),...(anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{})},
      orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    return {items:rows.slice(0,25).map(row=>this.scheduleView(row,publication?publication.sourceVersion+1:0,context.userId,access.capabilities.includes(RUN))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async scheduleOperation(context:RequestContext,id:string) {
    const access=await this.authorize(context,'system.billing.read'),publication=await this.publication();
    return this.scheduleView(await this.scheduleRow(id),publication?publication.sourceVersion+1:0,context.userId,access.capabilities.includes(RUN));
  }
  async previewSchedule(context:RequestContext,input:BillingScanScheduleInput,key:string) {
    await this.authorize(context,RUN);
    if(!this.stripe.enabled)throw billingError('BILLING_NOT_CONFIGURED','ยังไม่ได้เปิดการเชื่อมต่อ Stripe');
    const config=scheduleConfig(input);
    if(!config||!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||! /^[a-zA-Z0-9_-]{16,120}$/.test(key))throw new BadRequestException();
    const proposed:ScheduleSource={...config,membershipId:context.membershipId,actorCompanyId:context.companyId},reason=input.reason.trim();
    const requestHash=hashBilling([SCHEDULE,proposed,input.expectedVersion,reason,context.userId]);
    return this.prisma.client.$transaction(async tx=>{
      await this.lock(tx);await this.authorize(context,RUN,tx);
      const current=await this.publication(tx),revision=current?current.sourceVersion+1:0;
      const old=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,idempotencyKey:`scan-schedule:${key}`}}});
      if(old){if(old.type!==SCHEDULE||old.requestHash!==requestHash||old.initiatorUserId!==context.userId)throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','คำขอต่างจากรายการเดิม');return this.scheduleView(old,revision,context.userId,true);}
      if(revision!==input.expectedVersion)throw billingError('CONTROL_PREVIEW_STALE','การตั้งค่าเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนตรวจใหม่');
      const row=await tx.billingOperation.create({data:{...this.scheduleScope(),state:'PREVIEW',proposedJson:proposed,sourceVersion:revision,reason,
        initiatorUserId:context.userId,requestHash,idempotencyKey:`scan-schedule:${key}`,expiresAt:new Date(Date.now()+600000)}});
      await this.audit(tx,context,row,'schedule_previewed');return this.scheduleView(row,revision,context.userId,true);
    });
  }
  async actSchedule(context:RequestContext,id:string,action:string,expectedVersion:number,previewHash:string) {
    if(!['publish','cancel'].includes(action)||!Number.isInteger(expectedVersion)||typeof previewHash!=='string')throw new BadRequestException();
    return this.prisma.client.$transaction(async tx=>{
      await this.lock(tx);await this.authorize(context,RUN,tx);
      const row=await this.scheduleRow(id,tx),current=await this.publication(tx),revision=current?current.sourceVersion+1:0;
      if(row.initiatorUserId!==context.userId)throw new ForbiddenException();
      if(row.requestHash!==previewHash)throw billingError('CONTROL_PREVIEW_STALE','ข้อมูลที่ยืนยันต่างจากรายการเดิม');
      if(row.state===(action==='publish'?'SUCCEEDED':'CANCELLED'))return this.scheduleView(row,revision,context.userId,true);
      const view=this.scheduleView(row,revision,context.userId,true);
      if(row.version!==expectedVersion||(action==='publish'?!view.canPublish:!view.canCancel))throw billingError('CONTROL_PREVIEW_STALE','การตั้งค่าหรือเวลายืนยันเปลี่ยนแล้ว ตรวจข้อมูลใหม่ก่อนยืนยัน');
      if(action==='publish')await this.configuration.requireProof(context,tx);
      const saved=await tx.billingOperation.update({where:{id},data:{state:action==='publish'?'SUCCEEDED':'CANCELLED',observedAt:action==='publish'?new Date():null,version:{increment:1}}});
      await this.audit(tx,context,row,action==='publish'?'schedule_published':'schedule_cancelled');
      if(action==='publish'&&current)await resolveBillingIssue(tx,{companyId:null,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'PROVIDER_SCAN_SCHEDULE_BLOCKED',referenceId:current.id},'SCHEDULE_REPUBLISHED');
      return this.scheduleView(saved,action==='publish'?revision+1:revision,context.userId,true);
    });
  }
  private async scheduleDue() {
    return this.prisma.client.$transaction(async tx=>{
      await this.lock(tx);
      const publication=await this.publication(tx);
      if(!publication)return;
      const config=scheduleConfig(publication.proposedJson);
      if(config&&!config.enabled)return;
      const identity={companyId:null,stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,kind:'PROVIDER_SCAN_SCHEDULE_BLOCKED',referenceId:publication.id};
      let context:RequestContext;
      try{if(!config)throw new Error('Invalid schedule');context=await this.admin.authorizeOperation(publication,RUN,tx);}
      catch{await detectBillingIssue(tx,identity);return;}
      const last=await this.automatic(tx);
      if(last&&!['SUCCEEDED','CANCELLED'].includes(last.state))return;
      if(this.nextDue(publication,config!,last)>new Date())return;
      if(await tx.billingOperation.count({where:{...this.admissionScope(),state:{in:['QUEUED','RUNNING']}}})>=5)return;
      const completed=await this.automatic(tx,'SUCCEEDED'),now=Math.floor(Date.now()/1000),until=now-60;
      const requestedSince=completed?(completed.proposedJson as Source).until-300:last?(last.proposedJson as Source).since:until-config!.initialLookbackHours*3600;
      const since=Math.max(requestedSince,now-28*86400);
      const source:Source={since,until,membershipId:context.membershipId,actorCompanyId:context.companyId,scheduleId:publication.id};
      const row=await tx.billingOperation.create({data:{...this.scope(),state:'QUEUED',sourceVersion:publication.sourceVersion+1,proposedJson:source,
        initiatorUserId:context.userId,reason:`ตรวจอัตโนมัติ · การตั้งค่ารุ่น ${publication.sourceVersion+1}`,requestHash:hashBilling([TYPE,source]),
        idempotencyKey:`scheduled-scan:${publication.id}:${last?.id??'first'}`,expiresAt:new Date((since+29*86400)*1000),resultJson:empty()}});
      await this.audit(tx,context,row,'scheduled');
      await resolveBillingIssue(tx,identity,'SCHEDULE_AUTHORITY_VALID');
      if((completed||last)&&requestedSince<since)await detectBillingIssue(tx,{...identity,kind:'PROVIDER_SCAN_COVERAGE_GAP',referenceId:row.id});
    });
  }
  private async authorize(context: RequestContext, permission: string, tx: Prisma.TransactionClient = this.prisma.client,companyId?:string) {
    const access = await this.admin.access(context, permission, tx);
    if (!access.platformScope&&(!companyId||!access.companyIds.includes(companyId))) throw new NotFoundException();
    return access;
  }
  private view(row: BillingOperation, canRun: boolean, userId: string,currentAccount?:{id:string;customerId:string|null}|null): BillingProviderScanView {
    const source = row.proposedJson as Source, progress = row.resultJson as Progress;
    const changed=row.type===INVOICES&&(!invoiceWindow(source)||(currentAccount!==undefined&&(!currentAccount||currentAccount.id!==source.accountId||currentAccount.customerId!==source.customerId)));
    return { id: row.id, mode: row.livemode ? 'LIVE' : 'TEST', state: row.state, version: row.version, reason: row.reason,
      windowStart: new Date(source.since * 1000).toISOString(), windowEnd: new Date(source.until * 1000).toISOString(),
      createdAt: row.createdAt.toISOString(), checkpointAt: row.observedAt?.toISOString() ?? null,
      pages: progress.pages, seen: progress.seen, imported: progress.imported, known: progress.known, ignored: progress.ignored, incompatible: progress.incompatible,
      retryAt: progress.retryAt, errorCode:changed?'CONTROL_SOURCE_CHANGED':row.errorCode, automatic:row.type===TYPE&&row.sourceVersion>0,kind:row.type===INVOICES?'INVOICES':'EVENTS',
      ...(row.companyId?{companyId:row.companyId,invoiceFindings:{matched:progress.known,missing:progress.missing??0,different:progress.incompatible}}:{}),
      canCancel: canRun && ['QUEUED', 'RUNNING', 'UNKNOWN', 'BLOCKED'].includes(row.state),
      canResume: !changed&&canRun && this.stripe.enabled && row.initiatorUserId === userId && row.errorCode !== 'PAGE_LIMIT_REACHED' && ['UNKNOWN', 'BLOCKED'].includes(row.state) && (row.type===INVOICES||windowOpen(source)) && (!progress.retryAt || Date.parse(progress.retryAt) <= Date.now()) };
  }
  async get(context: RequestContext, id: string,companyId?:string) {
    const access = await this.authorize(context, 'system.billing.read',this.prisma.client,companyId);
    const row = await this.prisma.client.billingOperation.findFirst({ where: { ...this.scope(companyId), id } });
    if (!row) throw new NotFoundException();
    const account=companyId?await this.prisma.client.billingAccount.findFirst({where:{companyId,stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode},select:{id:true,customerId:true}}):undefined;
    return this.view(row, access.capabilities.includes(RUN), context.userId,account);
  }
  async list(context: RequestContext, cursor?: string,companyId?:string) {
    const access = await this.authorize(context, 'system.billing.read',this.prisma.client,companyId);
    const anchor = cursor ? await this.prisma.client.billingOperation.findFirst({ where: { ...this.scope(companyId), id: cursor } }) : null;
    if (cursor && !anchor) throw new NotFoundException();
    const rows = await this.prisma.client.billingOperation.findMany({ where: { ...this.scope(companyId), ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26 });
    const account=companyId?await this.prisma.client.billingAccount.findFirst({where:{companyId,stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode},select:{id:true,customerId:true}}):undefined;
    return { items: rows.slice(0, 25).map(row => this.view(row, access.capabilities.includes(RUN), context.userId,account)), nextCursor: rows.length > 25 ? rows[24]!.id : null, canCreate: this.stripe.enabled && access.capabilities.includes(RUN)&&(!companyId||Boolean(account?.customerId)) };
  }
  async create(context: RequestContext, input: { windowStart: string; windowEnd: string; reason: string }, key: string,companyId?:string) {
    await this.authorize(context, RUN,this.prisma.client,companyId);
    if (!this.stripe.enabled) throw billingError('BILLING_NOT_CONFIGURED', 'ยังไม่ได้เปิดการเชื่อมต่อ Stripe');
    const source: Source = { since: Math.floor(Date.parse(input.windowStart) / 1000), until: Math.floor(Date.parse(input.windowEnd) / 1000), membershipId: context.membershipId, actorCompanyId: context.companyId };
    if (![input.windowStart,input.windowEnd].every(value=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) ||
      !/^[a-zA-Z0-9_-]{16,120}$/.test(key) || !Number.isFinite(source.since) || !Number.isFinite(source.until) || source.since >= source.until ||
      source.until > Math.floor(Date.now() / 1000) - 60 || (companyId?source.since<0:!windowOpen(source)) || !input.reason.trim() || input.reason.length > 500) throw new BadRequestException('Invalid discovery window or request');
    if(companyId){const account=await this.prisma.client.billingAccount.findFirst({where:{companyId,stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode}});
      if(!account?.customerId)throw billingError('BILLING_NOT_CONFIGURED','บริษัทยังไม่มีบัญชี Stripe ที่ตรวจได้');source.accountId=account.id;source.customerId=account.customerId;}
    const requestHash = hashBilling([companyId?INVOICES:TYPE, source, input.reason.trim(), context.userId]);
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-discovery:${this.stripe.accountId}:${this.stripe.livemode}`},0))`;
      await this.authorize(context, RUN, tx,companyId);
      const old = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode, idempotencyKey: key } } });
      if (old) {
        if (old.type !== (companyId?INVOICES:TYPE) || old.requestHash !== requestHash || old.initiatorUserId !== context.userId) throw billingError('CONTROL_IDEMPOTENCY_CONFLICT', 'คำขอนี้ต่างจากรายการเดิม');
        return this.view(old, true, context.userId);
      }
      if (await tx.billingOperation.count({ where: { ...this.admissionScope(), state: { in: ['QUEUED', 'RUNNING'] } } }) >= 5) throw billingError('CONTROL_SCAN_BUSY', 'มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน');
      const row = await tx.billingOperation.create({ data: { ...this.scope(companyId), state: 'QUEUED', proposedJson: source, sourceVersion: 0,
        reason: input.reason.trim(), initiatorUserId: context.userId, requestHash, idempotencyKey: key,
        expiresAt: new Date(companyId?Date.now()+30*86400000:(source.since + 29 * 86400) * 1000), resultJson: empty() } });
      if(companyId)await this.authorizeRun(row,tx).catch(()=>{throw billingError('CONTROL_PREVIEW_STALE','บัญชีที่ใช้ตรวจเปลี่ยนแล้ว กรุณาโหลดและเริ่มตรวจใหม่');});
      await this.audit(tx, context, row, 'created');
      return this.view(row, true, context.userId);
    });
  }
  async act(context: RequestContext, id: string, action: string, expectedVersion: number,companyId?:string) {
    if (!['cancel', 'resume'].includes(action) || !Number.isInteger(expectedVersion)) throw new BadRequestException();
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-discovery:${this.stripe.accountId}:${this.stripe.livemode}`},0))`;
      await this.authorize(context, RUN, tx,companyId);
      const row = await tx.billingOperation.findFirst({ where: { ...this.scope(companyId), id } });
      if (!row) throw new NotFoundException();
      const allowed = this.view(row, true, context.userId);
      if (action === 'cancel' ? !allowed.canCancel : !allowed.canResume) throw new ForbiddenException();
      if (action === 'resume' && await tx.billingOperation.count({ where: { ...this.admissionScope(), state: { in: ['QUEUED', 'RUNNING'] } } }) >= 5) throw billingError('CONTROL_SCAN_BUSY', 'มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน');
      if(companyId&&action==='resume')await this.authorizeRun(row,tx).catch(()=>{throw billingError('CONTROL_PREVIEW_STALE','บัญชีหรือสิทธิ์เดิมเปลี่ยนแล้ว ยกเลิกงานเดิมและตรวจข้อมูลใหม่');});
      const updated = await tx.billingOperation.updateMany({ where: { id, version: expectedVersion, state: row.state }, data: {
        state: action === 'cancel' ? 'CANCELLED' : 'QUEUED', errorCode: null, leaseToken: null, leaseUntil: null, version: { increment: 1 },
      } });
      if (!updated.count) throw billingError('CONTROL_PREVIEW_STALE', 'งานเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
      await this.audit(tx, context, row, action);
      if(action==='cancel')await resolveBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:row.type===INVOICES?'PROVIDER_INVOICE_SCAN_FAILED':'PROVIDER_SCAN_FAILED',referenceId:row.id},'PROVIDER_DISCOVERY_CANCELLED_INCOMPLETE');
      return this.view(await tx.billingOperation.findUniqueOrThrow({ where: { id } }), true, context.userId);
    });
  }
  private audit(tx: Prisma.TransactionClient, context: RequestContext, row: BillingOperation, action: string) {
    return tx.auditLog.create({ data: { companyId:row.companyId,actorUserId: context.userId, action: `billing.discovery.${action}`, targetType: 'BillingOperation', targetId: row.id,
      requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { mode: row.livemode ? 'LIVE' : 'TEST', reason: row.reason } } });
  }
  private async authorizeRun(row:BillingOperation,tx:Prisma.TransactionClient=this.prisma.client) {
    const context=await this.admin.authorizeOperation(row,RUN,tx);
    if(row.type===INVOICES){
      const source=row.proposedJson as Source;
      if(tx!==this.prisma.client)await tx.$queryRaw`SELECT id FROM "BillingAccount" WHERE id=${source.accountId??''} FOR SHARE`;
      if(!invoiceWindow(source)||!source.accountId||!source.customerId||!await tx.billingAccount.findFirst({where:{id:source.accountId,companyId:row.companyId!,customerId:source.customerId,
        stripeAccountId:row.stripeAccountId,livemode:row.livemode}}))throw new StripeRequestError('REJECTED','scan_source_changed');
    }
    return context;
  }
  private async invoicePage(row:BillingOperation,progress:Progress,source:Source,lease:string) {
    const invalid=()=>new StripeRequestError('REJECTED','scan_page_invalid');
    await this.authorizeRun(row).catch(error=>{if(error instanceof StripeRequestError)throw error;throw new StripeRequestError('REJECTED','scan_authority_changed');});
    const page=await this.stripe.request('GET','/invoices',{customer:source.customerId,created:{gte:source.since,lte:source.until},limit:100,
      ...(progress.cursor?{starting_after:progress.cursor}:{})});
    if(page.object!=='list'||!Array.isArray(page.data)||page.data.length>100||typeof page.has_more!=='boolean')throw invalid();
    const invoices=page.data as StripeObject[],ids=new Set<string>();
    for(const invoice of invoices){
      if(!invoice||invoice.object!=='invoice'||typeof invoice.id!=='string'||!/^in_[a-zA-Z0-9]{1,120}$/.test(invoice.id)||ids.has(invoice.id)||
        stripeId(invoice.customer)!==source.customerId||invoice.livemode!==row.livemode||!Number.isSafeInteger(invoice.created)||invoice.created<source.since||invoice.created>source.until||
        !['draft','open','paid','uncollectible','void'].includes(invoice.status)||!Number.isSafeInteger(invoice.total)||!Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<0||
        typeof invoice.currency!=='string'||!/^[a-z]{3}$/.test(invoice.currency))throw invalid();
      ids.add(invoice.id);
    }
    const cursor=invoices.at(-1)?.id??progress.cursor;
    if(page.has_more&&(!invoices.length||cursor===progress.cursor))throw invalid();
    await this.prisma.client.$transaction(async tx=>{
      const context=await this.authorizeRun(row,tx).catch(error=>{if(error instanceof StripeRequestError)throw error;throw new StripeRequestError('REJECTED','scan_authority_changed');});
      const claimed=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{
        state:page.has_more?'QUEUED':'SUCCEEDED',leaseToken:null,leaseUntil:null,observedAt:new Date(),errorCode:null,version:{increment:1}}});
      if(!claimed.count)throw new Error('Lost invoice discovery lease');
      const mapped=await tx.billingInvoice.findMany({where:{billingAccountId:source.accountId,providerInvoiceId:{in:[...ids]}}});
      const observations=invoices.map(invoice=>{
        const local=mapped.find(candidate=>candidate.providerInvoiceId===invoice.id);
        const classification:InvoiceObservation['classification']=!local?'LOCAL_MISSING':local.providerStatus!==invoice.status||local.totalSatang!==invoice.total||
          local.paidSatang!==invoice.amount_paid||local.currency.toLowerCase()!==invoice.currency?'DIFFERENT':'MATCHED';
        const proposed:InvoiceObservation={accountId:source.accountId!,customerId:source.customerId!,providerInvoiceId:invoice.id,created:invoice.created,status:invoice.status,
          currency:invoice.currency,total:invoice.total,paid:invoice.amount_paid,classification};
        return {stripeAccountId:row.stripeAccountId,livemode:row.livemode,companyId:row.companyId,type:FINDING,state:'SUCCEEDED',referenceId:row.id,sourceVersion:0,
          reason:row.reason,initiatorUserId:row.initiatorUserId,idempotencyKey:`invoice-finding:${row.id}:${invoice.id}`,requestHash:hashBilling([row.id,proposed]),
          proposedJson:proposed,expiresAt:row.expiresAt,observedAt:new Date()};
      });
      // A committed page always advances its cursor atomically. Repeated IDs on a different page are invalid, not fresh findings.
      if(await tx.billingOperation.count({where:{stripeAccountId:row.stripeAccountId,livemode:row.livemode,idempotencyKey:{in:observations.map(item=>item.idempotencyKey)}}}))throw invalid();
      await tx.billingOperation.createMany({data:observations});
      const matched=observations.filter(item=>item.proposedJson.classification==='MATCHED').length,missing=observations.filter(item=>item.proposedJson.classification==='LOCAL_MISSING').length;
      const different=observations.length-matched-missing;
      await tx.billingOperation.update({where:{id:row.id},data:{resultJson:{...progress,cursor,pages:progress.pages+1,seen:progress.seen+invoices.length,
        imported:progress.imported+observations.length,known:progress.known+matched,missing:(progress.missing??0)+missing,incompatible:progress.incompatible+different,failures:0,retryAt:null}}});
      await this.audit(tx,context,row,page.has_more?'invoice_checkpoint':'invoice_completed');
      if(missing||different)await detectBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'PROVIDER_INVOICE_REVIEW',referenceId:source.accountId!});
      if(!page.has_more)await resolveBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'PROVIDER_INVOICE_SCAN_FAILED',referenceId:row.id},'INVOICE_DISCOVERY_COMPLETED');
    });
  }
  async invoiceFindings(context:RequestContext,companyId:string,id:string,cursor?:string) {
    await this.authorize(context,'system.billing.read',this.prisma.client,companyId);
    const run=await this.prisma.client.billingOperation.findFirst({where:{...this.scope(companyId),id}});
    if(!run)throw new NotFoundException();
    const source=run.proposedJson as Source;
    if(!source.accountId||!await this.prisma.client.billingAccount.findFirst({where:{id:source.accountId,companyId,stripeAccountId:run.stripeAccountId,livemode:run.livemode}}))throw new NotFoundException();
    const scope={stripeAccountId:run.stripeAccountId,livemode:run.livemode,companyId,type:FINDING,referenceId:id};
    const anchor=cursor?await this.prisma.client.billingOperation.findFirst({where:{...scope,id:cursor}}):null;
    if(cursor&&!anchor)throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...scope,...(anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{})},
      orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    const mapped=await this.prisma.client.billingInvoice.findMany({where:{billingAccountId:source.accountId,providerInvoiceId:{in:rows.slice(0,25).map(row=>(row.proposedJson as InvoiceObservation).providerInvoiceId)}}});
    const review=await this.prisma.client.billingIssue.findFirst({where:{companyId,stripeAccountId:run.stripeAccountId,livemode:run.livemode,kind:'PROVIDER_INVOICE_REVIEW',referenceId:source.accountId}});
    const items:BillingInvoiceFinding[]=rows.slice(0,25).map(row=>{
      const observation=row.proposedJson as InvoiceObservation,local=mapped.find(invoice=>invoice.providerInvoiceId===observation.providerInvoiceId);
      return {id:row.id,scanId:id,companyId,observedAt:(row.observedAt??row.createdAt).toISOString(),invoiceCreatedAt:new Date(observation.created*1000).toISOString(),
        providerStatus:observation.status,classification:observation.classification,localInvoiceId:local?.id??null,localApplyState:local?.applyStatus??null,reviewCaseId:review?.id??null};
    });
    return {items,nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async drain() {
    if (!this.stripe.enabled) return { processed: 0, failed: 0 };
    await this.scheduleDue();
    const rows = await this.prisma.client.billingOperation.findMany({ where: { ...this.admissionScope(), state: { in: ['QUEUED', 'RUNNING'] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 5 });
    let processed = 0, failed = 0;
    for (const row of rows.filter(row => !(row.resultJson as Progress).retryAt || Date.parse((row.resultJson as Progress).retryAt!) <= Date.now()).slice(0,1)) {
      const progress = row.resultJson as Progress, source = row.proposedJson as Source;
      if (progress.retryAt && Date.parse(progress.retryAt) > Date.now()) continue;
      const lease = randomUUID();
      const owned = await this.prisma.client.billingOperation.updateMany({ where: { id: row.id, version: row.version, state: row.state,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { state: 'RUNNING', leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000), version: { increment: 1 } } });
      if (!owned.count) continue;
      let authorized = false, errorCode = 'PROVIDER_UNAVAILABLE';
      try {
        await this.authorizeRun(row); authorized = true;
        if (row.type!==INVOICES&&!windowOpen(source)) { errorCode = 'RETENTION_WINDOW_EXPIRED'; throw new Error(); }
        if (progress.pages >= 2000) { errorCode = 'PAGE_LIMIT_REACHED'; throw new Error(); }
        await this.stripe.assertAccount();
        if(row.type===INVOICES){await this.invoicePage(row,progress,source,lease);processed++;continue;}
        const page = await this.stripe.request('GET', '/events', { created: { gte: source.since, lte: source.until }, limit: 100,
          ...(progress.cursor ? { starting_after: progress.cursor } : {}) });
        errorCode = 'PROVIDER_PAGE_INVALID';
        if (page.object !== 'list' || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== 'boolean') throw new Error();
        const events = page.data as StripeObject[], ids = new Set<string>();
        let ignored = 0, incompatible = 0;
        const imported: Prisma.BillingProviderEventCreateManyInput[] = [];
        for (const event of events) {
          if (!event || event.object !== 'event' || typeof event.id !== 'string' || !/^evt_[a-zA-Z0-9]+$/.test(event.id) || ids.has(event.id) ||
            !Number.isSafeInteger(event.created) || event.created < source.since || event.created > source.until ||
            event.livemode !== row.livemode || (event.account !== undefined && event.account !== row.stripeAccountId) || typeof event.type !== 'string') throw new Error();
          ids.add(event.id);
          if (!BILLING_STRIPE_EVENTS.has(event.type)) { ignored++; continue; }
          if (event.api_version !== STRIPE_API_VERSION) { incompatible++; continue; }
          if (!validBillingEvent(event, row.stripeAccountId, row.livemode)) throw new Error();
          imported.push({ stripeAccountId: row.stripeAccountId, livemode: row.livemode, eventId: event.id, eventType: event.type,
            objectId: event.data.object.id, apiVersion: event.api_version, evidenceHash: hashBilling(JSON.stringify(event)) });
        }
        const cursor = events.at(-1)?.id ?? progress.cursor;
        if (page.has_more && (!events.length || cursor === progress.cursor)) throw new Error();
        await this.prisma.client.$transaction(async tx => {
          const context = await this.admin.authorizeOperation(row, RUN, tx).catch(error => { authorized = false; throw error; });
          const claimed = await tx.billingOperation.updateMany({ where: { id: row.id, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data: {
            state: page.has_more ? 'QUEUED' : 'SUCCEEDED', leaseToken: null, leaseUntil: null, observedAt: new Date(), errorCode: null, version: { increment: 1 },
          } });
          if (!claimed.count) throw new Error('Lost discovery lease');
          const existing = await tx.billingProviderEvent.findMany({ where: { stripeAccountId: row.stripeAccountId, livemode: row.livemode, eventId: { in: imported.map(event => event.eventId) } } });
          if (existing.some(event => imported.some(source => source.eventId === event.eventId &&
            (source.eventType !== event.eventType || source.objectId !== event.objectId || source.apiVersion !== event.apiVersion)))) throw new Error('Conflicting event reference');
          const saved = await tx.billingProviderEvent.createMany({ data: imported, skipDuplicates: true });
          const result: Progress = { cursor, pages: progress.pages + 1, seen: progress.seen + events.length, imported: progress.imported + saved.count,
            known: progress.known + imported.length - saved.count, ignored: progress.ignored + ignored, incompatible: progress.incompatible + incompatible, failures: 0, retryAt: null };
          await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: result } });
          await this.audit(tx, context, row, page.has_more ? 'checkpoint' : 'completed');
          if (!page.has_more) await resolveBillingIssue(tx, { companyId: null, stripeAccountId: row.stripeAccountId, livemode: row.livemode,
            kind: 'PROVIDER_SCAN_FAILED', referenceId: row.id }, 'PROVIDER_DISCOVERY_COMPLETED');
          if (incompatible) await detectBillingIssue(tx, { companyId: null, stripeAccountId: row.stripeAccountId, livemode: row.livemode, kind: 'PROVIDER_SCAN_VERSION_UNSUPPORTED', referenceId: row.id });
        });
        processed++;
      } catch (error) {
        if(row.type===INVOICES&&error instanceof StripeRequestError){
          if(error.code==='scan_source_changed')errorCode='CONTROL_SOURCE_CHANGED';
          if(['scan_page_invalid','mode_mismatch'].includes(error.code))errorCode='PROVIDER_PAGE_INVALID';
          if(error.code==='scan_authority_changed')authorized=false;
        }
        const failures = progress.failures + 1, delay = error instanceof StripeRequestError ? error.retryAfterSeconds : 60;
        const retryAt = new Date(Date.now() + Math.min(86400, Math.max(delay, 30 * 2 ** Math.min(failures, 8))) * 1000).toISOString();
        const terminal = !authorized || ['CONTROL_SOURCE_CHANGED','RETENTION_WINDOW_EXPIRED', 'PAGE_LIMIT_REACHED', 'PROVIDER_PAGE_INVALID'].includes(errorCode);
        const state = terminal ? 'BLOCKED' : failures >= 5 ? 'UNKNOWN' : 'QUEUED';
        await this.prisma.client.$transaction(async tx => {
          const changed = await tx.billingOperation.updateMany({ where: { id: row.id, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data: {
            state, errorCode: authorized||errorCode==='CONTROL_SOURCE_CHANGED' ? errorCode : 'CONTROL_PERMISSION_CHANGED',
            leaseToken: null, leaseUntil: null, resultJson: { ...progress, failures, retryAt }, version: { increment: 1 },
          } });
          if (changed.count && state !== 'QUEUED') await detectBillingIssue(tx, { companyId: row.companyId, stripeAccountId: row.stripeAccountId, livemode: row.livemode,
            kind: row.type===INVOICES?'PROVIDER_INVOICE_SCAN_FAILED':'PROVIDER_SCAN_FAILED', referenceId: row.id });
        });
        failed++;
      }
    }
    return { processed, failed };
  }
}
