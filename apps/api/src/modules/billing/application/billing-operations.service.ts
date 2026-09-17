import { invoiceFindingSource } from './billing-invoice-finding';
import {billingRepairTypes as types,lockReconcileAuthority,reconcileCommandData} from './billing-reconcile-command';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingAccount, BillingInvoice, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { BillingInvoiceFindingReview, BillingApplyInvoiceView, BillingRepairOperation, BillingRepairPreview } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { BillingAdminService } from './billing-admin.service';
import { BillingReconcilerService } from './billing-reconciler.service';
import { BillingService } from './billing.service';
import { BillingNotificationsService } from './billing-notifications.service';
import { billingError, hashBilling } from '../domain/billing-policy';
import { resolveAppliedInvoiceIssues, detectBillingIssue, resolveBillingIssue } from './billing-issues';

const isDelivery=(type:string)=>['RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(type);
const permission = (type: string) => (type === 'RECONCILE' || type === 'RETRY_PROVIDER_EVENT') ? 'system.billing.reconcile.run' : ['RETRY_APPLY','IMPORT_INVOICE'].includes(type) ? 'system.billing.apply.retry' : isDelivery(type)?'system.billing.notification.retry':null;
type Proposed = { findingSourceHash?:string;findingImpact?:BillingRepairOperation['findingImpact']; accountId: string; membershipId: string; actorCompanyId: string; deliverySourceHash?:string;mailAttemptId?:string;deliveryImpact?:BillingRepairOperation['deliveryImpact'];eventSourceHash?:string;eventImpact?:BillingRepairOperation['eventImpact'];invoiceSourceHash?:string;invoiceImpact?:BillingRepairOperation['invoiceImpact'] };
@Injectable()
export class BillingOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly admin: BillingAdminService,
    private readonly billing: BillingService, private readonly reconciler: BillingReconcilerService,private readonly notifications:BillingNotificationsService) {}

  private async authorize(context: RequestContext, companyId: string | null, key: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const access = await this.admin.access(context, key, tx);
    if (companyId === null ? !access.platformScope : !access.platformScope && !access.companyIds.includes(companyId)) throw new NotFoundException();
  }
  private invoiceHash(row: BillingInvoice) {
    // Observation timestamps do not invalidate a review; financial/application changes do.
    return hashBilling([row.id,row.billingAccountId,row.version,row.providerInvoiceId,row.providerStatus,row.evidenceHash,row.contractSnapshot,row.offerSnapshot,
      row.sourceAttemptId,row.subscriptionId,row.periodStart,row.periodEnd,row.applyStatus,row.appliedAt,row.totalSatang,row.paidSatang,row.refundedSatang,row.disputed]);
  }
  private async invoiceRow(account: BillingAccount, id: string | null, tx: Prisma.TransactionClient = this.prisma.client) {
    if(!id)throw billingError('CONTROL_INVOICE_TARGET_REQUIRED','กรุณาเลือกใบเสร็จเดิมและตรวจผลกระทบใหม่');
    const row=await tx.billingInvoice.findFirst({where:{id,billingAccountId:account.id}});
    if(!row)throw new NotFoundException();return row;
  }
  private invoiceView(row:BillingInvoice,account:BillingAccount,canRun:boolean,reviewApplied=false):BillingApplyInvoiceView {
    const paymentVerified=row.providerStatus==='paid'&&row.paidSatang>0&&row.paidSatang===row.totalSatang;
    return {id:row.id,companyId:account.companyId,mode:account.livemode?'LIVE':'TEST',version:row.version,accountVersion:account.version,
      applyState:row.applyStatus,paymentVerified,periodStart:row.periodStart.toISOString(),periodEnd:row.periodEnd.toISOString(),
      appliedAt:row.appliedAt?.toISOString()??null,observedAt:row.financialObservedAt?.toISOString()??null,sourceHash:this.invoiceHash(row),
      // Already-applied invoices use the worker's read-only proof branch to resolve stale application issues.
      canRetry:this.billing.stripe.enabled&&canRun&&paymentVerified&&Boolean(row.evidenceHash)&&(row.applyStatus!=='APPLIED'||reviewApplied)};
  }
  private async appliedIssueReview(account:BillingAccount,invoice:BillingInvoice,tx:Prisma.TransactionClient=this.prisma.client) {
    if(invoice.applyStatus!=='APPLIED')return false;
    return Boolean(await tx.billingIssue.findFirst({where:{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,
      kind:{in:['PAID_HELD','PAID_NOT_APPLIED']},referenceId:{in:[invoice.id,invoice.providerInvoiceId]},state:{not:'RESOLVED'}},select:{id:true}}));
  }
  async applyInvoices(context:RequestContext,companyId:string,cursor?:string) {
    await this.authorize(context,companyId,'system.billing.read');const access=await this.admin.access(context,'system.billing.read');
    const account=await this.billing.account(companyId);if(!account){if(cursor)throw new NotFoundException();return {items:[],nextCursor:null};}
    if(cursor)await this.invoiceRow(account,cursor);
    const rows=await this.prisma.client.billingInvoice.findMany({where:{billingAccountId:account.id,applyStatus:{not:'APPLIED'},...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:26});
    return {items:rows.slice(0,25).map(row=>this.invoiceView(row,account,access.capabilities.includes('system.billing.apply.retry'))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async applyInvoice(context:RequestContext,companyId:string,id:string) {
    await this.authorize(context,companyId,'system.billing.read');const access=await this.admin.access(context,'system.billing.read');
    const account=await this.billing.account(companyId);if(!account)throw new NotFoundException();
    const invoice=await this.invoiceRow(account,id);
    return this.invoiceView(invoice,account,access.capabilities.includes('system.billing.apply.retry'),await this.appliedIssueReview(account,invoice));
  }
  async finding(context:RequestContext,companyId:string,id:string):Promise<BillingInvoiceFindingReview> {
    await this.authorize(context,companyId,'system.billing.read');const access=await this.admin.access(context,'system.billing.read');
    const account=await this.billing.account(companyId);if(!account)throw new NotFoundException();
    const source=await invoiceFindingSource(this.prisma.client,account,id),o=source.observation;
    const local=await this.prisma.client.billingInvoice.findUnique({where:{billingAccountId_providerInvoiceId:{billingAccountId:account.id,providerInvoiceId:o.providerInvoiceId}}});
    const issue=await this.prisma.client.billingIssue.findFirst({where:{companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,kind:'PROVIDER_INVOICE_REVIEW',referenceId:account.id}});
    return {id,scanId:source.scanId,companyId,observedAt:(source.row.observedAt??source.row.createdAt).toISOString(),invoiceCreatedAt:new Date(o.created*1000).toISOString(),
      providerStatus:o.status,classification:o.classification,localInvoiceId:local?.id??null,localApplyState:local?.applyStatus??null,reviewCaseId:issue?.id??null,
      accountVersion:account.version,sourceHash:source.sourceHash,canImport:source.bound&&!local&&o.status==='paid'&&o.paid>0&&o.paid===o.total&&this.billing.stripe.enabled&&access.capabilities.includes('system.billing.apply.retry')};
  }
  private async importSource(account:BillingAccount,row:Pick<BillingOperation,'referenceId'|'proposedJson'>,tx:Prisma.TransactionClient=this.prisma.client) {
    if(!row.referenceId)throw billingError('CONTROL_INVOICE_TARGET_REQUIRED','เลือกผลตรวจใบแจ้งหนี้เดิมก่อน');
    const source=await invoiceFindingSource(tx,account,row.referenceId);
    if(!source.bound||source.sourceHash!==(row.proposedJson as Proposed).findingSourceHash)throw billingError('CONTROL_INVOICE_SOURCE_CHANGED','บัญชีหรือผลตรวจต้นทางเปลี่ยนแล้ว ยกเลิกคำสั่งเดิมและตรวจใหม่');
    return source;
  }
  private view(row: BillingOperation, actorId: string): BillingRepairOperation {
    if ((!row.companyId && row.type !== 'RETRY_PROVIDER_EVENT') || !permission(row.type)) throw new NotFoundException();
    const owned = row.initiatorUserId === actorId, fresh = row.expiresAt > new Date();
    const apply=['RETRY_APPLY','IMPORT_INVOICE'].includes(row.type),targeted=!apply||Boolean(row.referenceId&&(row.proposedJson as Proposed)[row.type==='IMPORT_INVOICE'?'findingSourceHash':'invoiceSourceHash']);
    return { id: row.id, type: row.type as BillingRepairOperation['type'], state: row.state as BillingRepairOperation['state'],
      scope: row.companyId ? { kind: 'COMPANY', companyId: row.companyId, mode: row.livemode ? 'LIVE' : 'TEST' } : { kind: 'PLATFORM', mode: row.livemode ? 'LIVE' : 'TEST' }, version: row.version,
      reason: row.reason, initiatorUserId: row.initiatorUserId, approverUserId: null, errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(), observedAt: row.observedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString(),
      referenceId: row.referenceId, sourceVersion: row.sourceVersion, previewHash: row.requestHash,
      allowedActions: !owned ? (row.type==='IMPORT_INVOICE'&&['PREVIEW','QUEUED','UNKNOWN','FAILED','BLOCKED'].includes(row.state)?['cancel']:[]) : row.state === 'PREVIEW' ? [...(fresh&&targeted ? ['submit' as const] : []), 'cancel'] :
        row.state === 'QUEUED' ? ['cancel'] : ['UNKNOWN', 'FAILED', 'BLOCKED'].includes(row.state) ? [...(targeted?['retry' as const]:[]),...(apply?['cancel' as const]:[])] : [],
      ...row.type==='RETRY_APPLY'?{invoiceImpact:(row.proposedJson as Proposed).invoiceImpact}:{},
      ...row.type==='IMPORT_INVOICE'?{findingImpact:(row.proposedJson as Proposed).findingImpact}:{},
      ...row.type==='RETRY_PROVIDER_EVENT'?{eventImpact:(row.proposedJson as Proposed).eventImpact}:{},
      ...isDelivery(row.type)?{deliveryImpact:(row.proposedJson as Proposed).deliveryImpact}:{},observed: row.resultJson as BillingRepairOperation['observed'] };
  }
  private async row(context: RequestContext, id: string, key = 'system.billing.read', tx: Prisma.TransactionClient = this.prisma.client) {
    const row = await tx.billingOperation.findFirst({ where: { id, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      type: { in: types } } });
    if (!row || (!row.companyId && row.type !== 'RETRY_PROVIDER_EVENT')) throw new NotFoundException();
    await this.authorize(context, row.companyId, key, tx); return row;
  }
  async get(context: RequestContext, id: string) {
    const row = await this.row(context, id), result = this.view(row, context.userId);
    const access = await this.admin.access(context, 'system.billing.read');
    if (!access.capabilities.includes(permission(row.type)!)) result.allowedActions = [];
    return result;
  }
  async list(context: RequestContext, companyId: string | null, cursor?: string,referenceId?:string) {
    await this.authorize(context, companyId, 'system.billing.read');
    const access=await this.admin.access(context,'system.billing.read');
    if(companyId===null){if(!referenceId)throw new BadRequestException();await this.admin.providerEvent(context,referenceId);}
    if(cursor){const row=await this.row(context,cursor);if(row.companyId!==companyId||(referenceId&&row.referenceId!==referenceId))throw new NotFoundException();}
    const rows = await this.prisma.client.billingOperation.findMany({ where: { companyId, stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, type: companyId===null?'RETRY_PROVIDER_EVENT':{ in: types },...referenceId?{referenceId}:{}, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    return { items: rows.slice(0, 25).map(r => {const value=this.view(r,context.userId);
      if(!access.capabilities.includes(permission(r.type)!))value.allowedActions=[];return value;}), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }
  async previewEvent(context: RequestContext, input: { referenceId: string; sourceHash: string; reason: string }) {
    await this.authorize(context, null, 'system.billing.reconcile.run');
    const event = await this.admin.providerEvent(context, input.referenceId);
    if (!input.reason.trim() || input.reason.length > 500) throw new BadRequestException();
    if (!event.canRetry || event.sourceHash !== input.sourceHash) throw billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนแล้ว กรุณาตรวจสอบข้อมูลล่าสุด');
    const proposed = { membershipId: context.membershipId, actorCompanyId: context.companyId, eventSourceHash: event.sourceHash,
      eventImpact: { eventType: event.eventType, beforeState: event.state, attempts: event.attempts } };
    const row = await this.prisma.client.billingOperation.create({ data: { companyId: null, stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, type: 'RETRY_PROVIDER_EVENT', state: 'PREVIEW', referenceId: event.id,
      proposedJson: proposed, sourceVersion: event.attempts, reason: input.reason.trim(), initiatorUserId: context.userId,
      requestHash: hashBilling(['RETRY_PROVIDER_EVENT', event.id, proposed, input.reason.trim()]), expiresAt: new Date(Date.now() + 600_000) } });
    return this.view(row, context.userId);
  }
  private async lockOperation(tx: Prisma.TransactionClient, row: BillingOperation) {
    if (row.companyId) await lockPlanTermCompany(tx, row.companyId);
    else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-event-operation:${row.stripeAccountId}:${row.livemode}:${row.referenceId}`},0))`;
  }
  async preview(context: RequestContext, input: BillingRepairPreview) {
    const key = permission(input.type);
    if (!key || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.reason !== 'string' ||
        !input.reason.trim() || input.reason.length > 500) throw new BadRequestException('Invalid repair preview');
    await this.authorize(context, input.companyId, key);
    const account = await this.billing.account(input.companyId);
    if (!account || (input.type!=='IMPORT_INVOICE'&&account.version !== input.expectedVersion)) throw billingError('CONTROL_PREVIEW_STALE', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดบริษัทและตรวจสอบใหม่');
    const proposed: Proposed = { accountId: account.id, membershipId: context.membershipId, actorCompanyId: context.companyId };
    if(input.type==='IMPORT_INVOICE'){
      const view=await this.finding(context,input.companyId,input.referenceId??'');
      if(!view.canImport||input.findingSourceHash!==view.sourceHash)throw billingError('CONTROL_PREVIEW_STALE','โหลดผลตรวจเดิมและตรวจสิทธิ์ล่าสุดก่อน');
      proposed.findingSourceHash=view.sourceHash;proposed.findingImpact={scanId:view.scanId,findingId:view.id,beforeState:view.providerStatus,invoiceCreatedAt:view.invoiceCreatedAt};
    }else if(input.findingSourceHash!==undefined)throw new BadRequestException();
    if(input.type==='RETRY_APPLY'){
      const invoice=await this.invoiceRow(account,input.referenceId??null),view=this.invoiceView(invoice,account,true,await this.appliedIssueReview(account,invoice));
      if(!view.canRetry||input.invoiceSourceHash!==view.sourceHash)throw billingError('CONTROL_PREVIEW_STALE','ใบเสร็จหรือสิทธิ์เปลี่ยนแล้ว กรุณาโหลดใบเสร็จเดิมและตรวจใหม่');
      proposed.invoiceSourceHash=view.sourceHash;proposed.invoiceImpact={id:invoice.id,beforeState:invoice.applyStatus,periodStart:view.periodStart,periodEnd:view.periodEnd};
    }else if(input.invoiceSourceHash!==undefined)throw new BadRequestException();
    if(isDelivery(input.type)){
      if(!input.referenceId)throw new BadRequestException();
      const source=await this.notifications.reviewDelivery(input.companyId,input.referenceId);
      if(input.type==='RECONCILE_NOTIFICATION'?(source.kind!=='EMAIL'||!source.canReconcile):source.blockedReason)throw billingError('CONTROL_NOTIFICATION_REVIEW',`รายการส่งยังต้องแก้ไขเงื่อนไข: ${source.blockedReason}`);
      proposed.deliverySourceHash=source.sourceHash;
      if(input.type==='RECONCILE_NOTIFICATION'&&source.kind==='EMAIL')proposed.mailAttemptId=source.mail.evidenceAttempt!.id;
      const first=(source.row.metadataJson as {billing?:{firstStartedAt?:string}}).billing?.firstStartedAt;
      proposed.deliveryImpact={channel:source.row.channel,recipientUserId:source.row.recipient.userId,recipientName:source.recipientName,beforeState:source.row.status,afterState:input.type==='RECONCILE_NOTIFICATION'?'OBSERVED':'QUEUED',attemptCount:source.row.attemptCount,
        retryUntil:first?new Date(Date.parse(first)+23*3600000).toISOString():null,possibleDuplicate:source.kind==='EMAIL'&&source.possibleDuplicate};
    }else if(!['RETRY_APPLY','IMPORT_INVOICE'].includes(input.type)&&input.referenceId!==undefined)throw new BadRequestException();
    const row = await this.prisma.client.billingOperation.create({ data: input.type==='RECONCILE'?reconcileCommandData(context,account,input.reason):{ companyId: account.companyId, stripeAccountId: account.stripeAccountId,
      livemode: account.livemode, type: input.type, state: 'PREVIEW', proposedJson: proposed, sourceVersion: account.version,
      referenceId:input.referenceId,reason: input.reason.trim(), initiatorUserId: context.userId, requestHash: hashBilling([input.type, account.id, account.version, input.reason.trim(), proposed,input.referenceId??null]),
      expiresAt: new Date(Date.now() + 600_000) } });
    return this.view(row, context.userId);
  }
  async submit(context: RequestContext, input: { previewId: string; previewHash: string; expectedVersion: number }, idempotencyKey: string) {
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(idempotencyKey)) throw new BadRequestException('Invalid idempotency key');
    return this.prisma.client.$transaction(async tx => {
      const preview = await this.row(context, input.previewId, 'system.billing.read', tx);
      await this.authorize(context, preview.companyId!, permission(preview.type)!, tx);
      await this.lockOperation(tx, preview);
      const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: preview.stripeAccountId, livemode: preview.livemode, idempotencyKey } } });
      if (replay) {
        if (replay.id !== preview.id || replay.requestHash !== input.previewHash || replay.initiatorUserId !== context.userId) throw billingError('CONTROL_IDEMPOTENCY_CONFLICT', 'ข้อมูลคำสั่งต่างจากรายการเดิม');
        return this.view(replay, context.userId);
      }
      const proposed = preview.proposedJson as unknown as Proposed;
      const account = preview.companyId ? await tx.billingAccount.findUniqueOrThrow({ where: { id: proposed.accountId } }) : null;
      await this.authorize(context,preview.companyId,permission(preview.type)!,tx);
      if(preview.type==='IMPORT_INVOICE')await this.importSource(account!,preview,tx);
      if(preview.type==='RETRY_APPLY'){
        const invoice=await this.invoiceRow(account!,preview.referenceId,tx);
        if(!proposed.invoiceSourceHash||this.invoiceHash(invoice)!==proposed.invoiceSourceHash||!this.invoiceView(invoice,account!,true,await this.appliedIssueReview(account!,invoice,tx)).canRetry)throw billingError('CONTROL_PREVIEW_STALE','ใบเสร็จเดิมเปลี่ยนแล้ว กรุณาตรวจผลกระทบใหม่');
      }
      if(preview.type==='RETRY_PROVIDER_EVENT'){
        const event=await this.admin.providerEvent(context,preview.referenceId!,tx);
        if(!event.canRetry || event.sourceHash!==proposed.eventSourceHash)throw billingError('CONTROL_PREVIEW_STALE','รายการเดิมเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
      }
      if(isDelivery(preview.type)){
        const source=await this.notifications.reviewDelivery(preview.companyId!,preview.referenceId!,tx);
        const blocked=preview.type==='RECONCILE_NOTIFICATION'?(source.kind!=='EMAIL'||!source.canReconcile):source.blockedReason;
        if(blocked||source.sourceHash!==proposed.deliverySourceHash)throw billingError('CONTROL_PREVIEW_STALE','ข้อมูลรายการส่งเปลี่ยนแล้ว กรุณาตรวจสอบใหม่');
      }
      if (preview.state !== 'PREVIEW' || preview.initiatorUserId !== context.userId || preview.requestHash !== input.previewHash ||
          preview.version !== input.expectedVersion || preview.expiresAt <= new Date() || (account && preview.type!=='IMPORT_INVOICE'&&account.version !== preview.sourceVersion)) throw billingError('CONTROL_PREVIEW_STALE', 'รายการหรือสิทธิ์เปลี่ยนแล้ว กรุณาตรวจสอบใหม่');
      const pending = await tx.billingOperation.findFirst({ where: { companyId: preview.companyId, stripeAccountId: preview.stripeAccountId,
        livemode: preview.livemode, ...preview.companyId?{}:{referenceId:preview.referenceId}, type: { in: types }, state: { in: ['QUEUED', 'RUNNING', 'UNKNOWN'] } } });
      if (pending) throw billingError('CONTROL_OPERATION_IN_PROGRESS', 'มีคำสั่งเดิมกำลังตรวจสอบ เปิดประวัติคำสั่งของบริษัทเพื่อดำเนินการต่อ');
      const changed = await tx.billingOperation.updateMany({ where: { id: preview.id, state: 'PREVIEW', version: preview.version },
        data: { state: 'QUEUED', idempotencyKey, version: { increment: 1 } } });
      if (changed.count !== 1) throw billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนแล้ว กรุณาโหลดใหม่');
      await this.audit(tx, context, preview, 'queued', 'PREVIEW', 'QUEUED');
      return this.view(await tx.billingOperation.findUniqueOrThrow({ where: { id: preview.id } }), context.userId);
    });
  }
  async transition(context: RequestContext, id: string, expectedVersion: number, action: 'retry' | 'cancel') {
    return this.prisma.client.$transaction(async tx => {
      const row = await this.row(context, id, 'system.billing.read', tx);
      await this.authorize(context, row.companyId!, permission(row.type)!, tx);
      await this.lockOperation(tx, row);
      if ((row.initiatorUserId !== context.userId && !(action==='cancel'&&row.type==='IMPORT_INVOICE')) || row.version !== expectedVersion ||
          !(action === 'cancel' ? ['PREVIEW', 'QUEUED',...(['RETRY_APPLY','IMPORT_INVOICE'].includes(row.type)?['UNKNOWN','FAILED','BLOCKED']:[])] : ['UNKNOWN', 'FAILED', 'BLOCKED']).includes(row.state)) throw billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนแล้ว กรุณาตรวจสอบสถานะเดิม');
      await this.authorize(context,row.companyId,permission(row.type)!,tx);
      if(action==='retry'&&row.type==='IMPORT_INVOICE'){const account=await this.billing.account(row.companyId!,tx);if(!account)throw new NotFoundException();await this.importSource(account,row,tx);}
      if(action==='retry'&&row.type==='RETRY_APPLY'){
        const proposed=row.proposedJson as Proposed,account=await this.billing.account(row.companyId!,tx);
        if(!account||!proposed.invoiceSourceHash)throw billingError('CONTROL_INVOICE_TARGET_REQUIRED','เลือกใบเสร็จเดิมและตรวจใหม่');
        const invoice=await this.invoiceRow(account,row.referenceId,tx);
        if((invoice.applyStatus!=='APPLIED'||!invoice.appliedAt)&&this.invoiceHash(invoice)!==proposed.invoiceSourceHash)throw billingError('CONTROL_PREVIEW_STALE','ใบเสร็จเดิมเปลี่ยนแล้ว ยกเลิกคำสั่งนี้และตรวจผลกระทบใหม่');
      }
      if (action === 'retry' && await tx.billingOperation.findFirst({ where: { id: { not: id }, companyId: row.companyId,
        stripeAccountId: row.stripeAccountId, livemode: row.livemode, ...row.companyId?{}:{referenceId:row.referenceId}, type: { in: types },
        state: { in: ['QUEUED', 'RUNNING', 'UNKNOWN'] } } })) throw billingError('CONTROL_OPERATION_IN_PROGRESS', 'มีคำสั่งอื่นกำลังตรวจสอบบริษัทนี้ เปิดรายการเดิมก่อน');
      const next = action === 'cancel' ? 'CANCELLED' : 'QUEUED';
      const changed = await tx.billingOperation.updateMany({ where: { id, state: row.state, version: expectedVersion }, data: {
        state: next, leaseToken: null, leaseUntil: null, errorCode: null, version: { increment: 1 },
      } });
      if (!changed.count) throw billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนแล้ว กรุณาโหลดใหม่');
      if(action==='cancel'&&['RETRY_APPLY','IMPORT_INVOICE'].includes(row.type))await resolveBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,
        kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id},row.type==='IMPORT_INVOICE'?'INVOICE_IMPORT_COMMAND_CANCELLED':'INVOICE_APPLY_COMMAND_CANCELLED');
      await this.audit(tx, context, row, action, row.state, next);
      return this.view(await tx.billingOperation.findUniqueOrThrow({ where: { id } }), context.userId);
    });
  }
  private audit(tx: Prisma.TransactionClient, context: RequestContext, row: BillingOperation, action: string, before: string, after: string) {
    return tx.auditLog.create({ data: { companyId: row.companyId, actorUserId: context.userId, action: `billing.operation.${action}`,
      targetType: 'BillingOperation', targetId: row.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { before, after, reason: row.reason, type: row.type, sourceVersion: row.sourceVersion, mode:row.livemode?'LIVE':'TEST',referenceId:row.referenceId } } });
  }
  async drain() {
    if (!this.billing.stripe.enabled) return { processed: 0, failed: 0 };
    const rows = await this.prisma.client.billingOperation.findMany({ where: { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      type: { in: types }, state: { in: ['QUEUED', 'RUNNING'] }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
      orderBy: { createdAt: 'asc' }, take: 5 });
    let processed = 0, failed = 0;
    for (const row of rows) {
      const lease = randomUUID();
      const claimed = await this.prisma.client.billingOperation.updateMany({ where: { id: row.id, state: row.state, version: row.version,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { state: 'RUNNING', leaseToken: lease,
          leaseUntil: new Date(Date.now() + 180_000), version: { increment: 1 } } });
      if (!claimed.count) continue;
      let authorized = false, applyError='CONTROL_OBSERVED_MISMATCH';
      try {
        const proposed = row.proposedJson as unknown as Proposed;
        const context=await this.admin.authorizeOperation(row,permission(row.type)!); authorized = true;
        if(row.type==='RETRY_PROVIDER_EVENT'){
          const observed = await this.reconciler.reconcileEvent(row.referenceId!, true);
          if(observed!=='PROCESSED')throw Error('billing.provider_event_unconfirmed');
          await this.prisma.client.$transaction(async tx=>{
            const changed=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:'SUCCEEDED',observedAt:new Date(),
              leaseToken:null,leaseUntil:null,errorCode:null,version:{increment:1},resultJson:{pendingAttemptId:null,issueCount:0,eventState:'PROCESSED'}}});
            if(!changed.count)throw Error('billing.operation_lost_lease');
            await this.audit(tx,context,row,'observed','RUNNING','SUCCEEDED');
          });processed++;continue;
        }
        const account = await this.prisma.client.billingAccount.findFirstOrThrow({ where: { id: proposed.accountId, companyId: row.companyId!, stripeAccountId: row.stripeAccountId, livemode: row.livemode } });
        if(row.type==='IMPORT_INVOICE'){
          applyError='CONTROL_INVOICE_SOURCE_CHANGED';await this.importSource(account,row);
          const guard=async(tx:Prisma.TransactionClient)=>{
            await this.admin.authorizeOperation(row,'system.billing.apply.retry',tx).catch(error=>{authorized=false;throw error;});
            const locked=tx!==this.prisma.client;
            if(locked)await tx.$queryRaw`SELECT "id" FROM "BillingOperation" WHERE "id" = ${row.id} FOR UPDATE`;
            if(!await tx.billingOperation.findFirst({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}}}))throw new Error('billing.operation_lost_lease');
            const current=await tx.billingAccount.findUniqueOrThrow({where:{id:account.id}});await this.importSource(current,row,tx);
          };
          applyError='CONTROL_OBSERVED_MISMATCH';
          await this.reconciler.importDiscoveredInvoice(account.id,row.referenceId!,proposed.findingSourceHash!,guard);
          await this.prisma.client.$transaction(async tx=>{
            await lockPlanTermCompany(tx,account.companyId);await tx.$queryRaw`SELECT "id" FROM "BillingAccount" WHERE "id" = ${account.id} FOR SHARE`;await guard(tx);
            const current=await tx.billingAccount.findUniqueOrThrow({where:{id:account.id}}),source=await this.importSource(current,row,tx);
            const invoice=await tx.billingInvoice.findUniqueOrThrow({where:{billingAccountId_providerInvoiceId:{billingAccountId:account.id,providerInvoiceId:source.observation.providerInvoiceId}}});
            if(!invoice.evidenceHash||invoice.providerStatus!=='paid'||invoice.paidSatang<=0||invoice.paidSatang!==invoice.totalSatang)throw new Error('billing.import_unconfirmed');
            const changed=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:'SUCCEEDED',observedAt:new Date(),
              leaseToken:null,leaseUntil:null,errorCode:null,version:{increment:1},resultJson:{pendingAttemptId:current.activeAttemptId,invoiceId:invoice.id,invoiceApplyState:invoice.applyStatus,
                issueCount:await tx.billingIssue.count({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,state:{not:'RESOLVED'}}})}}});
            if(!changed.count)throw new Error('billing.operation_lost_lease');
            await resolveBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id},'ORIGINAL_INVOICE_IMPORTED');
            await this.audit(tx,context,row,'observed','RUNNING','SUCCEEDED');
          });processed++;continue;
        }
        if(row.type==='RETRY_APPLY'){
          if(!row.referenceId||!proposed.invoiceSourceHash){applyError='CONTROL_INVOICE_TARGET_REQUIRED';throw new Error();}
          applyError='CONTROL_INVOICE_SOURCE_CHANGED';
          const original=await this.invoiceRow(account,row.referenceId);
          if(original.applyStatus!=='APPLIED'||!original.appliedAt){
            if(this.invoiceHash(original)!==proposed.invoiceSourceHash)throw new Error();
            applyError='CONTROL_OBSERVED_MISMATCH';await this.reconciler.reconcileAccount(account.id,undefined,undefined,original.id);
          }
          applyError='CONTROL_OBSERVED_MISMATCH';
          await this.prisma.client.$transaction(async tx=>{
            await lockPlanTermCompany(tx,row.companyId!);await this.admin.authorizeOperation(row,'system.billing.apply.retry',tx).catch(error=>{authorized=false;throw error;});
            const invoice=await this.invoiceRow(account,row.referenceId,tx),current=await tx.billingAccount.findUniqueOrThrow({where:{id:account.id}});
            const state=invoice.applyStatus==='APPLIED'&&invoice.appliedAt&&invoice.evidenceHash&&this.invoiceView(invoice,current,false).paymentVerified?'SUCCEEDED':'UNKNOWN';
            const changed=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{
              state,observedAt:new Date(),leaseToken:null,leaseUntil:null,version:{increment:1},errorCode:state==='SUCCEEDED'?null:'CONTROL_INVOICE_NOT_APPLIED'}});
            if(!changed.count)throw new Error('billing.operation_lost_lease');
            const identity={companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id};
            if(state==='SUCCEEDED'){await resolveAppliedInvoiceIssues(tx,account,invoice.id);await resolveBillingIssue(tx,identity,'ORIGINAL_INVOICE_APPLIED');}else await detectBillingIssue(tx,identity);
            await tx.billingOperation.update({where:{id:row.id},data:{resultJson:{pendingAttemptId:current.activeAttemptId,invoiceId:invoice.id,invoiceApplyState:invoice.applyStatus,
              issueCount:await tx.billingIssue.count({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,state:{not:'RESOLVED'}}})}}});
            await this.audit(tx,context,row,'observed','RUNNING',state);
          });processed++;continue;
        }
        if(row.type==='RECONCILE_NOTIFICATION'){
          const deliveryState=await this.notifications.reconcileDelivery(row.companyId!,row.referenceId!,proposed.mailAttemptId!);
          await this.prisma.client.$transaction(async tx=>{
            const changed=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:'SUCCEEDED',observedAt:new Date(),
              leaseToken:null,leaseUntil:null,errorCode:['UNKNOWN','SENDING'].includes(deliveryState)?'MAIL_LOOKUP_UNCONFIRMED':null,version:{increment:1},
              resultJson:{pendingAttemptId:account.activeAttemptId,issueCount:await tx.billingIssue.count({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,state:{not:'RESOLVED'}}}),deliveryId:row.referenceId,deliveryState}}});
            if(!changed.count)throw Error('billing.operation_lost_lease');await this.audit(tx,context,row,'observed','RUNNING','SUCCEEDED');
          });processed++;continue;
        }
        if(row.type==='RETRY_NOTIFICATION'){
          await this.prisma.client.$transaction(async tx=>{
            await lockPlanTermCompany(tx,row.companyId!);await this.admin.authorizeOperation(row,permission(row.type)!,tx);
            await this.notifications.requeueDelivery(tx,row.companyId!,row.referenceId!,proposed.deliverySourceHash!,row.id);
            const changed=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:'SUCCEEDED',observedAt:new Date(),
              leaseToken:null,leaseUntil:null,errorCode:null,version:{increment:1},resultJson:{pendingAttemptId:account.activeAttemptId,issueCount:await tx.billingIssue.count({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,state:{not:'RESOLVED'}}}),deliveryId:row.referenceId,deliveryState:'QUEUED'}}});
            if(!changed.count)throw Error('billing.operation_lost_lease');await this.audit(tx,context,row,'observed','RUNNING','SUCCEEDED');
          });processed++;continue;
        }
        await this.reconciler.reconcileAccount(account.id);
        await this.prisma.client.$transaction(async tx => {
          await lockReconcileAuthority(tx,context,[row.companyId!]);
          await this.admin.authorizeOperation(row,'system.billing.reconcile.run',tx).catch(error=>{authorized=false;throw error;});
          await tx.$queryRaw`SELECT id FROM "BillingAccount" WHERE id=${account.id} FOR SHARE`;
          const live=await tx.billingOperation.findFirst({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()},type:'RECONCILE',
            companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,initiatorUserId:row.initiatorUserId,requestHash:row.requestHash}});
          if(!live||(live.proposedJson as Proposed).accountId!==account.id||(live.proposedJson as Proposed).membershipId!==proposed.membershipId||(live.proposedJson as Proposed).actorCompanyId!==proposed.actorCompanyId)throw new Error('billing.operation_source_changed');
          const current=await tx.billingAccount.findFirstOrThrow({where:{id:account.id,companyId:row.companyId!,stripeAccountId:row.stripeAccountId,livemode:row.livemode}});
          const attempt=current.activeAttemptId?await tx.billingAttempt.findFirst({where:{id:current.activeAttemptId,billingAccountId:current.id}}):null;
          const state=attempt?.status==='UNKNOWN'||(current.activeAttemptId&&!attempt)?'UNKNOWN':'SUCCEEDED';
          const changed = await tx.billingOperation.updateMany({ where: { id: row.id, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data: {
            state, observedAt: new Date(),
            leaseToken: null, leaseUntil: null, errorCode: state === 'UNKNOWN' ? 'CONTROL_OBSERVED_MISMATCH' : null, version: { increment: 1 },
          } });
          if (!changed.count) throw new Error('billing.operation_lost_lease');
          const identity={companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id};
          if(state==='SUCCEEDED')await resolveBillingIssue(tx,identity,'ACCOUNT_RECONCILIATION_OBSERVED');else await detectBillingIssue(tx,identity);
          const issueCount=await tx.billingIssue.count({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,state:{not:'RESOLVED'}}});
          await tx.billingOperation.update({where:{id:row.id},data:{resultJson:{pendingAttemptId:current.activeAttemptId,issueCount}}});
          await this.audit(tx, context, row, 'observed', 'RUNNING', state);
        });
        processed++;
      } catch {
        await this.prisma.client.$transaction(async tx=>{
          const changed = await tx.billingOperation.updateMany({ where: { id: row.id, leaseToken: lease, state: 'RUNNING', leaseUntil: { gt: new Date() } }, data: {
            state: authorized&&row.type!=='RETRY_NOTIFICATION'&&applyError==='CONTROL_OBSERVED_MISMATCH' ? 'UNKNOWN' : 'BLOCKED',
            errorCode: authorized ? applyError : 'CONTROL_PERMISSION_CHANGED',leaseToken: null, leaseUntil: null, version: { increment: 1 },
          } });
          if (changed.count && row.type!=='RETRY_PROVIDER_EVENT') await detectBillingIssue(tx,{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,
            kind:'CONTROL_OPERATION_REVIEW',referenceId:row.id});
        });failed++;
      }
    }
    return { processed, failed };
  }
}
