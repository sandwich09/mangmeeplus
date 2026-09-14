import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { BillingRepairOperation, BillingRepairPreview } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { BillingAdminService } from './billing-admin.service';
import { BillingReconcilerService } from './billing-reconciler.service';
import { BillingService } from './billing.service';
import { BillingNotificationsService } from './billing-notifications.service';
import { billingError, hashBilling } from '../domain/billing-policy';

const types=['RECONCILE','RETRY_APPLY','RETRY_NOTIFICATION','RECONCILE_NOTIFICATION','RETRY_PROVIDER_EVENT'];
const isDelivery=(type:string)=>['RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(type);
const permission = (type: string) => (type === 'RECONCILE' || type === 'RETRY_PROVIDER_EVENT') ? 'system.billing.reconcile.run' : type === 'RETRY_APPLY' ? 'system.billing.apply.retry' : isDelivery(type)?'system.billing.notification.retry':null;
type Proposed = { accountId: string; membershipId: string; actorCompanyId: string; deliverySourceHash?:string;mailAttemptId?:string;deliveryImpact?:BillingRepairOperation['deliveryImpact'];eventSourceHash?:string;eventImpact?:BillingRepairOperation['eventImpact'] };
@Injectable()
export class BillingOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly admin: BillingAdminService,
    private readonly billing: BillingService, private readonly reconciler: BillingReconcilerService,private readonly notifications:BillingNotificationsService) {}

  private async authorize(context: RequestContext, companyId: string | null, key: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const access = await this.admin.access(context, key, tx);
    if (companyId === null ? !access.platformScope : !access.platformScope && !access.companyIds.includes(companyId)) throw new NotFoundException();
  }
  private view(row: BillingOperation, actorId: string): BillingRepairOperation {
    if ((!row.companyId && row.type !== 'RETRY_PROVIDER_EVENT') || !permission(row.type)) throw new NotFoundException();
    const owned = row.initiatorUserId === actorId, fresh = row.expiresAt > new Date();
    return { id: row.id, type: row.type as BillingRepairOperation['type'], state: row.state as BillingRepairOperation['state'],
      scope: row.companyId ? { kind: 'COMPANY', companyId: row.companyId, mode: row.livemode ? 'LIVE' : 'TEST' } : { kind: 'PLATFORM', mode: row.livemode ? 'LIVE' : 'TEST' }, version: row.version,
      reason: row.reason, initiatorUserId: row.initiatorUserId, approverUserId: null, errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(), observedAt: row.observedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString(),
      referenceId: row.referenceId, sourceVersion: row.sourceVersion, previewHash: row.requestHash,
      allowedActions: !owned ? [] : row.state === 'PREVIEW' ? [...(fresh ? ['submit' as const] : []), 'cancel'] :
        row.state === 'QUEUED' ? ['cancel'] : ['UNKNOWN', 'FAILED', 'BLOCKED'].includes(row.state) ? ['retry'] : [],
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
    if(companyId===null){if(!referenceId)throw new BadRequestException();await this.admin.providerEvent(context,referenceId);}
    if(cursor){const row=await this.row(context,cursor);if(row.companyId!==companyId||(referenceId&&row.referenceId!==referenceId))throw new NotFoundException();}
    const rows = await this.prisma.client.billingOperation.findMany({ where: { companyId, stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, type: companyId===null?'RETRY_PROVIDER_EVENT':{ in: types },...referenceId?{referenceId}:{}, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    return { items: rows.slice(0, 25).map(r => this.view(r, context.userId)), nextCursor: rows.length > 25 ? rows[24]!.id : null };
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
    if (!account || account.version !== input.expectedVersion) throw billingError('CONTROL_PREVIEW_STALE', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดบริษัทและตรวจสอบใหม่');
    const proposed: Proposed = { accountId: account.id, membershipId: context.membershipId, actorCompanyId: context.companyId };
    if(isDelivery(input.type)){
      if(!input.referenceId)throw new BadRequestException();
      const source=await this.notifications.reviewDelivery(input.companyId,input.referenceId);
      if(input.type==='RECONCILE_NOTIFICATION'?(source.kind!=='EMAIL'||!source.canReconcile):source.blockedReason)throw billingError('CONTROL_NOTIFICATION_REVIEW',`รายการส่งยังต้องแก้ไขเงื่อนไข: ${source.blockedReason}`);
      proposed.deliverySourceHash=source.sourceHash;
      if(input.type==='RECONCILE_NOTIFICATION'&&source.kind==='EMAIL')proposed.mailAttemptId=source.mail.evidenceAttempt!.id;
      const first=(source.row.metadataJson as {billing?:{firstStartedAt?:string}}).billing?.firstStartedAt;
      proposed.deliveryImpact={channel:source.row.channel,recipientUserId:source.row.recipient.userId,beforeState:source.row.status,afterState:input.type==='RECONCILE_NOTIFICATION'?'OBSERVED':'QUEUED',attemptCount:source.row.attemptCount,
        retryUntil:first?new Date(Date.parse(first)+23*3600000).toISOString():null,possibleDuplicate:source.kind==='EMAIL'&&source.possibleDuplicate};
    }else if(input.referenceId!==undefined)throw new BadRequestException();
    const row = await this.prisma.client.billingOperation.create({ data: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
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
          preview.version !== input.expectedVersion || preview.expiresAt <= new Date() || (account && account.version !== preview.sourceVersion)) throw billingError('CONTROL_PREVIEW_STALE', 'รายการหรือสิทธิ์เปลี่ยนแล้ว กรุณาตรวจสอบใหม่');
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
      if (row.initiatorUserId !== context.userId || row.version !== expectedVersion ||
          !(action === 'cancel' ? ['PREVIEW', 'QUEUED'] : ['UNKNOWN', 'FAILED', 'BLOCKED']).includes(row.state)) throw billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนแล้ว กรุณาตรวจสอบสถานะเดิม');
      if (action === 'retry' && await tx.billingOperation.findFirst({ where: { id: { not: id }, companyId: row.companyId,
        stripeAccountId: row.stripeAccountId, livemode: row.livemode, ...row.companyId?{}:{referenceId:row.referenceId}, type: { in: types },
        state: { in: ['QUEUED', 'RUNNING', 'UNKNOWN'] } } })) throw billingError('CONTROL_OPERATION_IN_PROGRESS', 'มีคำสั่งอื่นกำลังตรวจสอบบริษัทนี้ เปิดรายการเดิมก่อน');
      const next = action === 'cancel' ? 'CANCELLED' : 'QUEUED';
      const changed = await tx.billingOperation.updateMany({ where: { id, state: row.state, version: expectedVersion }, data: {
        state: next, leaseToken: null, leaseUntil: null, errorCode: null, version: { increment: 1 },
      } });
      if (!changed.count) throw billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนแล้ว กรุณาโหลดใหม่');
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
      let authorized = false;
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
        const current = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        const attempt = current.activeAttemptId ? await this.prisma.client.billingAttempt.findUnique({ where: { id: current.activeAttemptId } }) : null;
        const state = attempt?.status === 'UNKNOWN' ? 'UNKNOWN' : 'SUCCEEDED';
        await this.prisma.client.$transaction(async tx => {
          if (state === 'SUCCEEDED') await tx.billingIssue.updateMany({ where: { companyId: row.companyId, stripeAccountId: row.stripeAccountId,
            livemode: row.livemode, kind: 'CONTROL_OPERATION_REVIEW', referenceId: row.id, state: { not: 'RESOLVED' } },
            data: { state: 'RESOLVED', resolvedAt: new Date(), version: { increment: 1 } } });
          const issueCount = await tx.billingIssue.count({ where: { companyId: row.companyId, stripeAccountId: row.stripeAccountId, livemode: row.livemode, state: { not: 'RESOLVED' } } });
          const changed = await tx.billingOperation.updateMany({ where: { id: row.id, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data: {
            state, observedAt: new Date(), resultJson: { pendingAttemptId: current.activeAttemptId, issueCount },
            leaseToken: null, leaseUntil: null, errorCode: state === 'UNKNOWN' ? 'CONTROL_OBSERVED_MISMATCH' : null, version: { increment: 1 },
          } });
          if (!changed.count) throw new Error('billing.operation_lost_lease');
          await this.audit(tx, context, row, 'observed', 'RUNNING', state);
        });
        if (state === 'UNKNOWN') await this.billing.issue(row.companyId, 'CONTROL_OPERATION_REVIEW', row.id);
        processed++;
      } catch {
        const changed = await this.prisma.client.billingOperation.updateMany({ where: { id: row.id, leaseToken: lease, state: 'RUNNING', leaseUntil: { gt: new Date() } }, data: {
          state: authorized&&row.type!=='RETRY_NOTIFICATION' ? 'UNKNOWN' : 'BLOCKED', errorCode: authorized ? 'CONTROL_OBSERVED_MISMATCH' : 'CONTROL_PERMISSION_CHANGED',
          leaseToken: null, leaseUntil: null, version: { increment: 1 },
        } });
        if (changed.count && row.type!=='RETRY_PROVIDER_EVENT') await this.billing.issue(row.companyId, 'CONTROL_OPERATION_REVIEW', row.id); failed++;
      }
    }
    return { processed, failed };
  }
}
