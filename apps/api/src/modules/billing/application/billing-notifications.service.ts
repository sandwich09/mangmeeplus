import { assertNotDemoCompany } from '../../sales-demo/application/demo-company-access';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { BillingDeliveryView } from '@watchdog-bms/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { OutboxEvent, Prisma } from '../../../generated/prisma/client';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { buildLineMessage, CreateOrUpdateNotificationEventUseCase, pushLineMessage } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { DEFAULT_ENABLED_CHANNELS, IMPLEMENTED_TRIGGER_KEYS, MAX_DELIVERY_ATTEMPTS } from '../../dashboard-notifications/domain/models/notification.model';
import { isInQuietHours, resolveDeliveryOutcome } from '../../dashboard-notifications/domain/logic/notification.logic';
import { EmailDeliveryService } from '../../auth/application/email-delivery.service';
import { PostmarkSendError } from '../../auth/infrastructure/postmark.client';
import { renderBillingRecipientAdminNoticeEmail, renderBillingRecipientChangedEmail, renderBillingResendEmail, renderBillingStatusEmail } from '../../auth/infrastructure/auth-email.templates';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { planManagerRoleFilter } from '../../access-control/domain/logic/plan-manager.logic';
import { BillingService, latestPackageInvoice, type BillingSnapshot } from './billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BILLING_RECIPIENT_CHANGED } from './billing-email-recipient';
import { billingError, hashBilling } from '../domain/billing-policy';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { resolveBillingIssue } from './billing-issues';

export const BILLING_NOTICE_EMAIL = 'billing.status.email';
const APPLIED = 'billing.invoice.applied';
/** R-A7: `recipientUserId` null = the company's document recipient (the column), not a user.
 *  `resend` (R-D1: the customer or admin resend) asks for the resend subject/body, never the
 *  "package updated" one this same outbox event otherwise always rendered. */
type NoticePayload = { data?: { recipientUserId?: unknown; resend?: unknown } };
const defer = (code: string) => new PostmarkSendError('RETRY', code, 60);
/** PR E (R-E2): the copy mailed to the OLD recipient never spells out the new address in full. */
const maskRecipientEmail = (email: string) => { const at = email.indexOf('@');
  return at <= 0 ? email : `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`; };

@Injectable()
export class BillingNotificationsService {
  constructor(private readonly lineCredentials: LineMessagingCredentialsService, private readonly prisma: PrismaService, private readonly config: AppConfigService, private readonly billing: BillingService,
    private readonly outbox: PrismaOutboxRepository, private readonly events: CreateOrUpdateNotificationEventUseCase,
    private readonly email: EmailDeliveryService, private readonly admin:BillingAdminService) {}

  private async authorize(context:RequestContext,companyId:string) {
    const access=await this.admin.access(context,'system.billing.read');
    if(!access.platformScope&&!access.companyIds.includes(companyId))throw new NotFoundException();
    return access;
  }
  async deliveries(context:RequestContext,companyId:string,cursor?:string) {
    await this.authorize(context,companyId);
    if(cursor)await this.reviewDelivery(companyId,cursor);
    const rows=await this.prisma.client.$queryRaw<Array<{id:string}>>`
      WITH deliveries AS (SELECT d.id FROM "NotificationDelivery" d JOIN "NotificationRecipient" r ON r.id=d."recipientId" AND r."companyId"=d."companyId"
      JOIN "NotificationEvent" e ON e.id=r."eventId" AND e."companyId"=d."companyId" AND e."sourceModule"='billing' AND e."sourceType"='invoice'
      JOIN "BillingInvoice" i ON i.id=e."sourceId" JOIN "BillingAccount" a ON a.id=i."billingAccountId" AND a."companyId"=d."companyId"
      WHERE d."companyId"=${companyId} AND a."stripeAccountId"=${this.billing.stripe.accountId} AND a.livemode=${this.billing.stripe.livemode}
      UNION ALL SELECT 'email:'||o.id FROM "OutboxEvent" o JOIN "BillingInvoice" i ON i.id=o."aggregateId" AND o."aggregateType"='BillingInvoice'
        JOIN "BillingAccount" a ON a.id=i."billingAccountId" AND a."companyId"=o."companyId"
        WHERE o."companyId"=${companyId} AND o."eventType"=${BILLING_NOTICE_EMAIL} AND a."stripeAccountId"=${this.billing.stripe.accountId} AND a.livemode=${this.billing.stripe.livemode})
      SELECT id FROM deliveries WHERE (${cursor??null}::text IS NULL OR id COLLATE "C">${cursor??''} COLLATE "C") ORDER BY id COLLATE "C" LIMIT 26`;
    return {items:await Promise.all(rows.slice(0,25).map(r=>this.delivery(context,companyId,r.id))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async delivery(context:RequestContext,companyId:string,id:string):Promise<BillingDeliveryView> {
    const access=await this.authorize(context,companyId);const source=await this.reviewDelivery(companyId,id),{row,account,blockedReason}=source;
    return {id:row.id,companyId,mode:account.livemode?'LIVE':'TEST',channel:row.channel,invoiceId:row.recipient.event.sourceId!,recipientUserId:row.recipient.userId,
      companyName:source.companyName,recipientName:source.recipientName,invoiceNumber:source.invoiceNumber,
      state:row.status,attemptCount:row.attemptCount,updatedAt:row.updatedAt.toISOString(),nextAttemptAt:row.nextAttemptAt?.toISOString()??null,
      acceptedAt:row.sentAt?.toISOString()??null,confirmedAt:source.kind==='EMAIL'?source.mail.evidenceAttempt?.deliveredAt?.toISOString()??null:null,errorCode:row.errorCode,recoveryBlockedReason:blockedReason,accountVersion:account.version,
      retryOperationId:(row.metadataJson as {retryOperationId?:string}).retryOperationId??null,canRetry:!blockedReason&&access.capabilities.includes('system.billing.notification.retry'),
      canReconcile:source.kind==='EMAIL'&&source.canReconcile&&access.capabilities.includes('system.billing.notification.retry'),possibleDuplicate:source.kind==='EMAIL'&&source.possibleDuplicate,
      ...source.kind==='EMAIL'?{mailHistory:source.mail.attempts.map(a=>({id:a.id,generation:a.generation,state:a.status,acceptedAt:a.submittedAt?.toISOString()??null,
        deliveredAt:a.deliveredAt?.toISOString()??null,errorCode:a.errorCode,possibleDuplicate:a.possibleDuplicate||a.errorCode==='delivery_unconfirmed_possible_duplicate'}))}:{} };
  }
  async reviewDelivery(companyId:string,id:string,tx:Prisma.TransactionClient=this.prisma.client) {
    if(id.startsWith('email:'))return this.reviewEmailDelivery(companyId,id.slice(6),tx);
    const row=await tx.notificationDelivery.findFirst({where:{id,companyId,recipient:{companyId,event:{companyId,sourceModule:'billing',sourceType:'invoice'}}},include:{recipient:{include:{event:true}}}});
    const invoice=row?.recipient.event.sourceId?await tx.billingInvoice.findUnique({where:{id:row.recipient.event.sourceId}}):null;
    const account=invoice?await tx.billingAccount.findUnique({where:{id:invoice.billingAccountId}}):null;
    if(!row||!invoice||!account||account.companyId!==companyId||account.stripeAccountId!==this.billing.stripe.accountId||account.livemode!==this.billing.stripe.livemode)throw new NotFoundException();
    const company=await tx.company.findUniqueOrThrow({where:{id:companyId},include:{planTerm:true}}),settings=await this.billing.settings(tx);
    const owner=(await this.planManagers(companyId,tx)).find(m=>m.userId===row.recipient.userId);
    const preference=await tx.notificationPreference.findUnique({where:{companyId_userId:{companyId,userId:row.recipient.userId}}});
    const channelId=this.config.lineMessagingChannelId,identity=channelId?await tx.externalIdentity.findFirst({where:{userId:row.recipient.userId,provider:'LINE',providerChannelId:channelId,status:'ACTIVE'}}):null;
    const channels=Array.isArray(preference?.enabledChannelsJson)?preference.enabledChannelsJson:DEFAULT_ENABLED_CHANNELS;
    const triggers=Array.isArray(preference?.enabledTriggerKeysJson)?preference.enabledTriggerKeysJson:IMPLEMENTED_TRIGGER_KEYS;
    let blockedReason:string|null=null,binding:string|null=null;
    if(!this.billing.stripe.enabled||!settings.gates.notification_delivery)blockedReason='NOTIFICATION_PAUSED';
    else if(invoice.applyStatus!=='APPLIED'||!invoice.appliedAt||(company.status!=='ACTIVE'&&!(company.status==='DISABLED'&&company.planTerm?.termDisabledAt)))blockedReason='SOURCE_HELD';
    else if(row.channel!=='LINE')blockedReason='WEB_DELIVERY_AUTOMATIC';
    else if(!['FAILED','SKIPPED'].includes(row.status))blockedReason=row.status==='SENT'?'ALREADY_ACCEPTED':'DELIVERY_NOT_RETRYABLE';
    else if(row.recipient.event.status!=='OPEN'||!owner)blockedReason='RECIPIENT_OR_EVENT_INACTIVE';
    else if(!channels.includes('line')||!triggers.includes(row.recipient.event.triggerKey))blockedReason='PREFERENCE_SUPPRESSED';
    else if(!channelId||!await this.lineCredentials.get(tx).then(credentials=>Boolean(credentials.accessToken),()=>false))blockedReason='LINE_CONFIGURATION_MISSING';
    else if(!identity)blockedReason='NO_LINE_DELIVERY_TARGET';
    if(identity)try{
      const message=buildLineMessage({companyId,title:row.recipient.event.title,body:row.recipient.event.body,severity:row.recipient.event.severity.toLowerCase(),deepLinkHref:this.billingHref(companyId)});
      binding=createHash('sha256').update(JSON.stringify({channelId,to:identity.providerUserId,message})).digest('hex');
    }catch{blockedReason??='LINE_CONFIGURATION_MISSING';}
    const previous=(row.metadataJson as {billing?:{binding?:string;firstStartedAt?:string}}).billing;
    if(!blockedReason&&previous&&(previous.binding!==binding||!previous.firstStartedAt||!Number.isFinite(Date.parse(previous.firstStartedAt))))blockedReason='LINE_BINDING_CHANGED';
    if(!blockedReason&&previous&&Date.now()-Date.parse(previous.firstStartedAt!)>=23*3600000)blockedReason='LINE_UNKNOWN_REVIEW';
    if(!blockedReason&&row.attemptCount>=MAX_DELIVERY_ATTEMPTS)blockedReason='LINE_RETRY_EXHAUSTED';
    const sourceHash=hashBilling([row.updatedAt,row.status,row.attemptCount,row.metadataJson,invoice.id,invoice.applyStatus,invoice.appliedAt,
      account.version,company.status,company.planTerm?.termDisabledAt,owner?.id,owner?.userId,preference,settings.settings.version,binding]);
    return {kind:'NOTIFICATION' as const,row,account,sourceHash,blockedReason,binding,companyName:company.name,recipientName:owner?.user.displayName??null,invoiceNumber:invoice.providerNumber};
  }
  private async reviewEmailDelivery(companyId:string,id:string,tx:Prisma.TransactionClient) {
    const outbox=await tx.outboxEvent.findFirst({where:{id,companyId,aggregateType:'BillingInvoice',eventType:BILLING_NOTICE_EMAIL}});
    const invoice=outbox?await tx.billingInvoice.findUnique({where:{id:outbox.aggregateId}}):null;
    const account=invoice?await tx.billingAccount.findUnique({where:{id:invoice.billingAccountId}}):null;
    if(!outbox||!invoice||!account||account.companyId!==companyId||account.stripeAccountId!==this.billing.stripe.accountId||account.livemode!==this.billing.stripe.livemode)throw new NotFoundException();
    const userId=(outbox.payloadJson as NoticePayload).data?.recipientUserId;
    if(userId!==null&&typeof userId!=='string')throw new NotFoundException();
    const resend=Boolean((outbox.payloadJson as NoticePayload).data?.resend);
    const company=await tx.company.findUniqueOrThrow({where:{id:companyId},include:{planTerm:true}}),settings=await this.billing.settings(tx);
    const owner=typeof userId==='string'?(await this.owners(companyId,tx)).find(m=>m.userId===userId):undefined;
    const recipient=typeof userId==='string'?owner?.user.email?.trim().toLowerCase()??null:account.recipientEmail;
    const intentKey=`billing-notice:${outbox.id}`,attempts=await tx.emailSendAttempt.findMany({where:{intentKey},orderBy:{generation:'desc'},take:6}),attempt=attempts[0]??null;
    const serverId=this.config.postmarkServerId,stream=this.config.postmarkMessageStream;
    const mappingValid=Boolean(serverId&&stream)&&attempts.every(a=>a.provider==='postmark'&&a.providerServerId===serverId&&a.stream===stream&&a.purpose==='billing_status'&&!a.signupRequestId);
    const evidenceAttempt=attempts.find(a=>a.status==='ACCEPTED'&&a.providerMessageId&&!a.suppressedAt)??attempt;
    const canReconcile=Boolean(mappingValid&&((attempt&&['SENDING','UNKNOWN'].includes(attempt.status)&&attempt.dispatchStartedAt&&attempt.nextRecoveryAt&&attempt.nextRecoveryAt<=new Date())||
      (evidenceAttempt?.status==='ACCEPTED'&&['FAILED','DEAD'].includes(outbox.status))));
    let binding:string|null=null,blockedReason:string|null=null;
    if(!this.billing.stripe.enabled||!settings.gates.notification_delivery)blockedReason='NOTIFICATION_PAUSED';
    else if(invoice.applyStatus!=='APPLIED'||!invoice.appliedAt||(company.status!=='ACTIVE'&&!(company.status==='DISABLED'&&company.planTerm?.termDisabledAt)))blockedReason='SOURCE_HELD';
    else if(!recipient||(typeof userId==='string'&&!owner?.user.emailVerifiedAt))blockedReason=typeof userId==='string'?'VERIFIED_EMAIL_REQUIRED':'RECIPIENT_MISSING';
    else if(!this.email.isPostmark||!mappingValid||!this.config.postmarkServerToken||!this.config.postmarkFromAddress)blockedReason='MAIL_CONFIGURATION_CHANGED';
    else if(attempts.some(a=>a.recipient!==recipient))blockedReason='MAIL_RECIPIENT_CHANGED';
    else if(attempts.some(a=>a.suppressedAt||a.status==='SUPPRESSED')||await tx.emailSuppression.findUnique({where:{providerServerId_stream_recipient:{providerServerId:serverId!,stream,recipient}}}))blockedReason='PREFERENCE_SUPPRESSED';
    else if(attempts.some(a=>a.status==='ACCEPTED'||a.deliveredAt||a.providerMessageId))blockedReason='ALREADY_ACCEPTED';
    else if(['PENDING','PROCESSING'].includes(outbox.status))blockedReason='DELIVERY_NOT_RETRYABLE';
    else if(attempt&&['SENDING','UNKNOWN'].includes(attempt.status))blockedReason='MAIL_LOOKUP_REQUIRED';
    else if(attempt?.deadlineAt&&attempt.deadlineAt<=new Date())blockedReason='MAIL_PROOF_EXPIRED';
    else if(attempt?.status!=='READY'&&attempt&&(!['CONFIG','PERMANENT','RETRY'].includes(attempt.status)||attempt.generation>=5))blockedReason='MAIL_RETRY_EXHAUSTED';
    else if(attempt?.nextRecoveryAt&&attempt.nextRecoveryAt>new Date())blockedReason='MAIL_BACKOFF';
    if(recipient)try{binding=this.emailBinding(company.name,companyId,recipient,resend).binding;}catch{blockedReason??='MAIL_CONFIGURATION_CHANGED';}
    const recovery=(outbox.headersJson as {billingRecovery?:{operationId:string;attemptId:string;binding:string}}|null)?.billingRecovery;
    const row={id:`email:${outbox.id}`,channel:'EMAIL' as const,status:evidenceAttempt?.status??outbox.status,attemptCount:attempt?.generation??0,
      updatedAt:attempts.reduce((date,a)=>a.updatedAt>date?a.updatedAt:date,outbox.updatedAt),nextAttemptAt:attempt?.nextRecoveryAt??null,sentAt:evidenceAttempt?.submittedAt??null,
      errorCode:evidenceAttempt?.status==='ACCEPTED'?null:attempt?.errorCode??outbox.lastError,metadataJson:{retryOperationId:recovery?.operationId},recipient:{userId,event:{sourceId:invoice.id}}};
    const sourceHash=hashBilling([outbox.updatedAt,outbox.status,outbox.headersJson,attempts,company.status,company.planTerm?.termDisabledAt,owner?.id,owner?.user.emailVerifiedAt,settings.settings.version,binding,account.version]);
    return {kind:'EMAIL' as const,row,account,sourceHash,blockedReason,binding,canReconcile,possibleDuplicate:Boolean(attempt?.possibleDuplicate||attempt?.errorCode==='delivery_unconfirmed_possible_duplicate'),
      companyName:company.name,recipientName:owner?.user.displayName??null,invoiceNumber:invoice.providerNumber,
      mail:{outbox,attempt,attempts,evidenceAttempt,intentKey,recipient}};
  }
  private emailBinding(companyName:string,companyId:string,recipient:string,resend=false) {
    const content=resend?renderBillingResendEmail(companyName,this.billingHref(companyId)):renderBillingStatusEmail(companyName,this.billingHref(companyId));
    return {content,binding:hashBilling([this.config.postmarkServerId,this.config.postmarkMessageStream,this.config.postmarkFromAddress,this.config.postmarkFromName,recipient,'billing_status',content])};
  }
  async reconcileDelivery(companyId:string,reference:string,attemptId:string) {
    const source=await this.reviewDelivery(companyId,reference);
    if(source.kind!=='EMAIL'||!attemptId)throw new NotFoundException();
    const attempt=await this.prisma.client.emailSendAttempt.findFirst({where:{id:attemptId,intentKey:source.mail.intentKey,provider:'postmark',providerServerId:this.config.postmarkServerId,stream:this.config.postmarkMessageStream,purpose:'billing_status'}});
    if(!attempt)throw new NotFoundException();
    await this.email.reconcileUnknown(attempt.id);
    const observed=await this.prisma.client.emailSendAttempt.findUniqueOrThrow({where:{id:attempt.id}});
    if(observed.status==='ACCEPTED'&&observed.providerMessageId)await this.resolveEmailIssues(companyId,source.mail.outbox.id);
    return observed.status;
  }
  async requeueDelivery(tx:Prisma.TransactionClient,companyId:string,id:string,sourceHash:string,operationId:string) {
    const source=await this.reviewDelivery(companyId,id,tx);
    if(source.blockedReason||source.sourceHash!==sourceHash)throw billingError('CONTROL_PREVIEW_STALE','รายการหรือผู้รับเปลี่ยนแล้ว กรุณาเปิดรายการส่งเดิมและตรวจสอบใหม่');
    if(source.kind==='EMAIL'){
      const {outbox,attempt,intentKey,recipient}=source.mail;
      const prepared=await this.email.prepareReviewedBilling({companyId,intentKey,recipient:recipient!,expectedLatestId:attempt?.id??null},tx);
      const changed=await tx.outboxEvent.updateMany({where:{id:outbox.id,companyId,updatedAt:outbox.updatedAt,status:outbox.status},data:{status:'PENDING',availableAt:new Date(),claimToken:null,lockedAt:null,lockedBy:null,
        headersJson:{...(outbox.headersJson as Prisma.InputJsonObject??{}),billingRecovery:{operationId,attemptId:prepared.id,binding:source.binding}}}});
      if(!changed.count)throw billingError('CONTROL_PREVIEW_STALE','รายการอีเมลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
      return;
    }
    const changed=await tx.notificationDelivery.updateMany({where:{id,companyId,updatedAt:source.row.updatedAt,status:source.row.status},data:{status:'QUEUED',nextAttemptAt:new Date(),
      metadataJson:{...(source.row.metadataJson as Prisma.InputJsonObject),retryOperationId:operationId,retryBinding:source.binding}}});
    if(!changed.count)throw billingError('CONTROL_PREVIEW_STALE','รายการส่งเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
  }
  private async retryAuthority(operationId:unknown,companyId:string,deliveryId:string,tx:Prisma.TransactionClient=this.prisma.client) {
    if(operationId===undefined)return;
    if(typeof operationId!=='string')throw new Error('CONTROL_PERMISSION_CHANGED');
    const row=await tx.billingOperation.findFirst({where:{id:operationId,companyId,type:'RETRY_NOTIFICATION',state:'SUCCEEDED',referenceId:deliveryId}});
    if(!row)throw new Error('CONTROL_PERMISSION_CHANGED');
    try{await this.admin.authorizeOperation(row,'system.billing.notification.retry',tx);}catch{throw new Error('CONTROL_PERMISSION_CHANGED');}
  }

  async drain() {
    if (!this.billing.stripe.enabled || !(await this.billing.settings()).gates.notification_delivery) return { processed: 0, failed: 0 };
    await this.outbox.reclaimStalledProcessing();
    const claimToken = randomUUID(), stripeAccountId = this.billing.stripe.accountId, livemode = this.billing.stripe.livemode;
    // The generic outbox has no environment column. Join its owned invoice before claiming,
    // so this worker can never consume the other mode's notification intent.
    const rows = await this.prisma.client.$queryRaw<OutboxEvent[]>`
      WITH candidates AS (
        SELECT o.id FROM "OutboxEvent" o JOIN "BillingInvoice" i ON o."aggregateType" = 'BillingInvoice' AND o."aggregateId" = i.id
        JOIN "BillingAccount" a ON i."billingAccountId" = a.id AND o."companyId" = a."companyId"
        WHERE a."stripeAccountId" = ${stripeAccountId} AND a.livemode = ${livemode}
          AND o."eventType" IN (${APPLIED}, ${BILLING_NOTICE_EMAIL}) AND o.status IN ('PENDING', 'FAILED') AND o."availableAt" <= now()
        ORDER BY o."createdAt", o.id LIMIT 10 FOR UPDATE OF o SKIP LOCKED
      ) UPDATE "OutboxEvent" o SET status = 'PROCESSING', "lockedAt" = now(), "lockedBy" = 'billing-notifications',
          "claimToken" = ${claimToken}, "updatedAt" = now() FROM candidates c WHERE o.id = c.id RETURNING o.*`;
    // R-A8: a completed recipient change belongs to the account, not an invoice. A separate claim keeps
    // the invoice claim above byte-for-byte and needs no locking clause under a UNION.
    const changes = await this.prisma.client.$queryRaw<OutboxEvent[]>`
      WITH candidates AS (
        SELECT o.id FROM "OutboxEvent" o JOIN "BillingAccount" a ON o."aggregateType" = 'BillingAccount' AND o."aggregateId" = a.id
          AND o."companyId" = a."companyId"
        WHERE a."stripeAccountId" = ${stripeAccountId} AND a.livemode = ${livemode}
          AND o."eventType" = ${BILLING_RECIPIENT_CHANGED} AND o.status IN ('PENDING', 'FAILED') AND o."availableAt" <= now()
        ORDER BY o."createdAt", o.id LIMIT 10 FOR UPDATE OF o SKIP LOCKED
      ) UPDATE "OutboxEvent" o SET status = 'PROCESSING', "lockedAt" = now(), "lockedBy" = 'billing-notifications',
          "claimToken" = ${claimToken}, "updatedAt" = now() FROM candidates c WHERE o.id = c.id RETURNING o.*`;
    let processed = 0, failed = 0;
    for (const row of [...rows, ...changes]) {
      try {
        if (row.eventType === APPLIED) await this.produce(row);
        else if (row.eventType === BILLING_RECIPIENT_CHANGED) await this.recipientChanged(row);
        else await this.sendEmail(row);
        if (await this.outbox.markPublished({ id: row.id, claimToken, expectedEventType: row.eventType })) processed++;
      } catch (error) {
        const code = error instanceof PostmarkSendError ? error.code : 'notification_review_required';
        await this.billing.issue(row.companyId, 'NOTIFICATION_REVIEW', row.id);
        if(row.eventType===BILLING_NOTICE_EMAIL&&['CONTROL_PERMISSION_CHANGED','MAIL_BINDING_CHANGED'].includes(code)){
          await this.prisma.client.outboxEvent.updateMany({where:{id:row.id,status:'PROCESSING',claimToken},data:{status:'DEAD',lastError:code,claimToken:null,lockedAt:null,lockedBy:null}});
          failed++;continue;
        }
        await this.outbox.markFailed({ id: row.id, claimToken, expectedEventType: row.eventType, error: code,
          nextAvailableAt: new Date(Date.now() + 60000), countsTowardMax: !['notification_paused', 'recipient_pending', 'pending_reconciliation', 'backoff'].includes(code) });
        failed++;
      }
    }
    await this.observeRecipientBounces();
    const deliveries = await this.drainDeliveries();
    return { processed, failed, deliveries };
  }

  private async source(row: OutboxEvent, tx: Prisma.TransactionClient = this.prisma.client) {
    if (row.companyId) await assertNotDemoCompany(tx, row.companyId);
    const lease = await tx.outboxEvent.findFirst({ where: { id: row.id, status: 'PROCESSING', claimToken: row.claimToken,
      lockedAt: { gt: new Date(Date.now() - 300000) } } });
    if (!lease) throw new Error('billing.notification_lease_lost');
    return this.invoiceSource(row.aggregateId, row.companyId, tx);
  }

  private async invoiceSource(invoiceId: string, companyId: string | null, tx: Prisma.TransactionClient = this.prisma.client) {
    const invoice = await tx.billingInvoice.findUnique({ where: { id: invoiceId } });
    const account = invoice ? await tx.billingAccount.findUnique({ where: { id: invoice.billingAccountId } }) : null;
    if (!this.billing.stripe.enabled || !invoice || !invoice.appliedAt || invoice.applyStatus !== 'APPLIED' || !account || account.companyId !== companyId ||
      account.stripeAccountId !== this.billing.stripe.accountId || account.livemode !== this.billing.stripe.livemode) throw new Error('billing.notification_source_changed');
    const company = await tx.company.findUniqueOrThrow({ where: { id: account.companyId }, include: { planTerm: true } });
    if ((company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt)) ||
      !(await this.billing.settings(tx)).gates.notification_delivery) throw defer('notification_paused');
    return { invoice, company, account };
  }

  private async owners(companyId: string, tx: Prisma.TransactionClient = this.prisma.client) {
    return tx.companyMembership.findMany({ where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' },
      roles: { some: { role: { key: 'OWNER', status: 'ACTIVE' } } } }, include: { user: true } });
  }

  /** R-C11: LINE/web recipients are whoever may manage the package. Email goes to the document recipient
   *  (R-A7); `owners()` remains only for accounts whose recipient column is still empty. */
  private async planManagers(companyId: string, tx: Prisma.TransactionClient = this.prisma.client) {
    return tx.companyMembership.findMany({ where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' }, ...planManagerRoleFilter() }, include: { user: true } });
  }

  private async produce(row: OutboxEvent) {
    await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, row.companyId!);
      const { invoice, company, account } = await this.source(row, tx);
      const managers = await this.planManagers(company.id, tx), owners = await this.owners(company.id, tx);
      if (!managers.length) throw defer('recipient_pending');
      const contract = invoice.contractSnapshot as unknown as BillingSnapshot | null;
      const purchaseMode = contract?.quote.purchaseMode;
      // S41: the deal wording, on the existing trigger. No price and no months travel over LINE.
      const body = contract?.deal
        ? 'ใช้งานข้อเสนอพิเศษแล้ว ตรวจสอบสิทธิ์ วันหมดอายุ และประวัติการชำระเงินได้ในหน้าบริษัท'
        : purchaseMode === 'CARD_ONCE' || purchaseMode === 'PROMPTPAY_ONCE'
        ? 'ตรวจสอบสิทธิ์ วันหมดอายุ และประวัติการชำระเงินได้ในหน้าบริษัท หากต้องการใช้ต่อให้ซื้อใหม่'
        : purchaseMode === 'PROMPTPAY_RENEW'
          ? 'ตรวจสอบสิทธิ์ วันออกบิล QR รอบถัดไป และประวัติการชำระเงินได้ในหน้าบริษัท'
          : 'ตรวจสอบสิทธิ์ วันต่ออายุ และประวัติการชำระเงินได้ในหน้าบริษัท';
      await this.events.executeInTransaction({ companyId: company.id, triggerKey: 'billing.package_updated', sourceModule: 'billing', sourceType: 'invoice',
        sourceId: invoice.id, severity: 'info', title: 'อัปเดตแพ็กเกจมั่งมี', body,
        deepLinkHref: `/companies/${encodeURIComponent(company.id)}/billing`, recipientUserIds: managers.map(m => m.userId) }, tx);
      // R-A7: one mail to the company's document recipient, whether or not any owner verified an email.
      if (account.recipientEmail) {
        await tx.outboxEvent.upsert({ where: { eventKey: `billing:notice-email:${invoice.id}:recipient` }, update: {}, create: {
          companyId: company.id, eventType: BILLING_NOTICE_EMAIL, aggregateType: 'BillingInvoice', aggregateId: invoice.id,
          eventKey: `billing:notice-email:${invoice.id}:recipient`, payloadJson: { schemaVersion: 2, data: { recipientUserId: null } },
        } });
      } else for (const owner of owners.filter(m => m.user.email && m.user.emailVerifiedAt)) {
        // Legacy fan-out until the backfill or the next capture fills the recipient column.
        await tx.outboxEvent.upsert({ where: { eventKey: `billing:notice-email:${invoice.id}:${owner.userId}` }, update: {}, create: {
          companyId: company.id, eventType: BILLING_NOTICE_EMAIL, aggregateType: 'BillingInvoice', aggregateId: invoice.id,
          eventKey: `billing:notice-email:${invoice.id}:${owner.userId}`, payloadJson: { schemaVersion: 1, data: { recipientUserId: owner.userId } },
        } });
      }
    });
  }

  private async sendEmail(row: OutboxEvent) {
    const { company, account } = await this.source(row), userId = (row.payloadJson as NoticePayload).data?.recipientUserId;
    if (userId !== null && typeof userId !== 'string') throw new Error('billing.notification_recipient_missing');
    const resend = Boolean((row.payloadJson as NoticePayload).data?.resend);
    // A user id is the legacy owner fan-out (verified owner email); null is the document recipient column (R-A7).
    const resolveRecipient = async () => {
      if (typeof userId === 'string') {
        const owner = (await this.owners(company.id)).find(m => m.userId === userId);
        return owner?.user.email && owner.user.emailVerifiedAt ? owner.user.email.trim().toLowerCase() : null;
      }
      return (await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } })).recipientEmail;
    };
    const recipient = await resolveRecipient();
    if (!recipient) {
      await this.billing.issue(company.id, 'NOTIFICATION_RECIPIENT_CHANGED', row.id); return;
    }
    if (!this.email.isPostmark) throw new PostmarkSendError('CONFIG', 'mail_provider_unavailable');
    const recovery=(row.headersJson as {billingRecovery?:{operationId:string;attemptId:string;binding:string}}|null)?.billingRecovery;
    const {content,binding}=this.emailBinding(company.name,company.id,recipient,resend);
    if(recovery){
      try{if(!recovery.operationId)throw Error();await this.retryAuthority(recovery.operationId,company.id,`email:${row.id}`);}catch{throw new PostmarkSendError('PERMANENT','CONTROL_PERMISSION_CHANGED');}
      if(recovery.binding!==binding)throw new PostmarkSendError('PERMANENT','MAIL_BINDING_CHANGED');
    }
    const attempt = recovery?await this.prisma.client.emailSendAttempt.findFirstOrThrow({where:{id:recovery.attemptId,intentKey:`billing-notice:${row.id}`,
      purpose:'billing_status',signupRequestId:null,provider:'postmark',providerServerId:this.config.postmarkServerId,stream:this.config.postmarkMessageStream,recipient}}):
      await this.email.prepare({ companyId: company.id, purpose: 'billing_status', recipient, intentKey: `billing-notice:${row.id}` });
    try {
      const current=await this.source(row);
      if(recovery){
        try{await this.retryAuthority(recovery.operationId,company.id,`email:${row.id}`);}catch{throw new PostmarkSendError('PERMANENT','CONTROL_PERMISSION_CHANGED');}
        if(recovery.binding!==this.emailBinding(current.company.name,company.id,attempt.recipient,resend).binding)throw new PostmarkSendError('PERMANENT','MAIL_BINDING_CHANGED');
      }
      if (await resolveRecipient() !== attempt.recipient) throw new PostmarkSendError('SUPPRESSED', 'recipient_changed');
    } catch (error) {
      await this.prisma.client.emailSendAttempt.updateMany({ where: { id: attempt.id, status: 'SENDING', dispatchStartedAt: null },
        data: { status: 'RETRY', errorCode: 'billing_send_not_started', nextRecoveryAt: new Date(Date.now() + 60000) } });
      throw error;
    }
    await this.email.send(attempt, content);
    await this.resolveEmailIssues(company.id,row.id);
  }

  private async resolveEmailIssues(companyId:string,outboxId:string){
    await this.prisma.client.$transaction(async tx=>{
      if(!await tx.emailSendAttempt.findFirst({where:{intentKey:`billing-notice:${outboxId}`,purpose:'billing_status',providerServerId:this.config.postmarkServerId,
        stream:this.config.postmarkMessageStream,status:'ACCEPTED',providerMessageId:{not:null},suppressedAt:null}}))return;
      await tx.outboxEvent.updateMany({where:{id:outboxId,companyId,eventType:BILLING_NOTICE_EMAIL,status:{in:['FAILED','DEAD']}},data:{status:'PUBLISHED',publishedAt:new Date(),claimToken:null,lockedAt:null,lockedBy:null}});
      for(const kind of ['NOTIFICATION_REVIEW','NOTIFICATION_RECIPIENT_CHANGED'])await resolveBillingIssue(tx,
        {companyId,stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,kind,referenceId:outboxId},'POSTMARK_REQUEST_ACCEPTED');
    });
  }

  /** Looks up the latest attempt of a prepared notice, retries it once if transient, and sends `content`
   *  when it is still due. A suppressed address has nobody to tell, so that alone is not an error. */
  private async sendRecipientNotice(intentKey: string, content: ReturnType<typeof renderBillingStatusEmail>) {
    try {
      let attempt = await this.prisma.client.emailSendAttempt.findFirstOrThrow({ where: { intentKey }, orderBy: { generation: 'desc' } });
      if (attempt.status === 'RETRY' && attempt.generation < 5) attempt = await this.email.prepare({ companyId: attempt.companyId ?? undefined, purpose: 'billing_status', recipient: attempt.recipient, intentKey });
      if (['READY', 'SENDING'].includes(attempt.status) && !attempt.dispatchStartedAt) await this.email.send(attempt, content);
    } catch (error) { if (!(error instanceof PostmarkSendError) || error.kind !== 'SUPPRESSED') throw error; }
  }

  /** R-A8/R-E2: after a completed recipient change (customer OTP/account email, or PR E admin), mail the
   *  old recipient — and, for an admin change, the new one too (a social-engineering target) — and tell
   *  every plan manager on web/LINE. `source`/`newNoticeAttemptId` are additive PR E outbox fields. */
  private async recipientChanged(row: OutboxEvent) {
    const lease = await this.prisma.client.outboxEvent.findFirst({ where: { id: row.id, status: 'PROCESSING', claimToken: row.claimToken,
      lockedAt: { gt: new Date(Date.now() - 300000) } } });
    if (!lease) throw new Error('billing.notification_lease_lost');
    const account = await this.prisma.client.billingAccount.findUnique({ where: { id: row.aggregateId } });
    const data = (row.payloadJson as { data?: { operationId?: unknown; source?: unknown; noticeAttemptId?: unknown; newNoticeAttemptId?: unknown } }).data ?? {};
    if (!this.billing.stripe.enabled || !account || account.companyId !== row.companyId || account.stripeAccountId !== this.billing.stripe.accountId ||
        account.livemode !== this.billing.stripe.livemode || typeof data.operationId !== 'string') throw new Error('billing.notification_source_changed');
    const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: account.companyId } });
    const admin = data.source === 'ADMIN', href = this.billingHref(company.id);
    const intentKey = `billing-recipient-notice:${data.operationId}`;
    if (typeof data.noticeAttemptId === 'string' && this.email.isPostmark) {
      await this.sendRecipientNotice(intentKey, admin
        ? renderBillingRecipientAdminNoticeEmail(company.name, href, account.recipientEmail ? maskRecipientEmail(account.recipientEmail) : 'อีเมลใหม่')
        : renderBillingRecipientChangedEmail(company.name, href));
    }
    if (admin && typeof data.newNoticeAttemptId === 'string' && this.email.isPostmark && account.recipientEmail) {
      await this.sendRecipientNotice(`${intentKey}:new`, renderBillingRecipientAdminNoticeEmail(company.name, href, account.recipientEmail));
    }
    // The LINE delivery joins an applied invoice (drainDeliveries); without one there is nothing to anchor it.
    const latest = await latestPackageInvoice(this.prisma.client, { billingAccountId: account.id, applyStatus: 'APPLIED', appliedAt: { not: null } });
    if (!latest) return;
    await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, company.id);
      const managers = await this.planManagers(company.id, tx);
      // Existing trigger (a new key is blocked by stored preferences, F12); the period key makes it a new event.
      await this.events.executeInTransaction({ companyId: company.id, triggerKey: 'billing.package_updated', sourceModule: 'billing', sourceType: 'invoice',
        sourceId: latest.id, periodKey: `recipient-changed:${data.operationId}`, severity: 'info',
        title: admin ? 'อัปเดตผู้รับเอกสาร' : 'เปลี่ยนอีเมลรับเอกสารแล้ว',
        body: admin ? 'ทีมงานเปลี่ยนอีเมลรับเอกสารให้ตามคำขอแล้ว ตรวจสอบได้ในหน้าแพ็กเกจ หากไม่ได้ขอเปลี่ยน กรุณาติดต่อทีมงาน'
          : 'อีเมลรับเอกสารการชำระเงินของบริษัทถูกเปลี่ยนแล้ว หากไม่ได้ทำรายการนี้ กรุณาติดต่อทีมงานทันที',
        deepLinkHref: `/companies/${encodeURIComponent(company.id)}/billing`, recipientUserIds: managers.map(m => m.userId) }, tx);
    });
  }

  /**
   * R-A7: our billing mail to the document recipient was refused (Postmark bounce, spam complaint or an
   * inactive address). Flag it once and tell the plan managers once. Billing reads the attempts itself —
   * auth never calls billing (module cycle). `status = 'SUPPRESSED'` also covers a send Postmark refused
   * up front (406), which records no `suppressedAt`.
   */
  private async observeRecipientBounces() {
    const due = await this.prisma.client.$queryRaw<Array<{ attemptId: string; accountId: string; companyId: string }>>`
      SELECT a.id AS "attemptId", b.id AS "accountId", b."companyId"
      FROM "EmailSendAttempt" a
      JOIN "OutboxEvent" o ON o.id = substring(a."intentKey" from 16) AND a."intentKey" = 'billing-notice:' || o.id AND o."aggregateType" = 'BillingInvoice'
      JOIN "BillingInvoice" i ON i.id = o."aggregateId" JOIN "BillingAccount" b ON b.id = i."billingAccountId" AND b."companyId" = o."companyId"
      WHERE a.status = 'SUPPRESSED' AND a.purpose = 'billing_status' AND COALESCE(a."suppressedAt", a."updatedAt") >= now() - interval '30 days'
        AND b."recipientEmail" = a.recipient AND b."recipientBouncedAt" IS NULL
        AND b."stripeAccountId" = ${this.billing.stripe.accountId} AND b.livemode = ${this.billing.stripe.livemode}
      ORDER BY COALESCE(a."suppressedAt", a."updatedAt"), a.id LIMIT 20`;
    for (const row of due) {
      try {
        await this.prisma.client.$transaction(async tx => {
          await lockPlanTermCompany(tx, row.companyId);
          const attempt = await tx.emailSendAttempt.findUniqueOrThrow({ where: { id: row.attemptId } });
          const bouncedAt = attempt.suppressedAt ?? attempt.updatedAt;
          // The recipient may have changed since the query: then this bounce no longer applies.
          const flagged = await tx.billingAccount.updateMany({ where: { id: row.accountId, recipientEmail: attempt.recipient, recipientBouncedAt: null },
            data: { recipientBouncedAt: bouncedAt } });
          if (!flagged.count) return;
          await tx.auditLog.create({ data: { companyId: row.companyId, action: 'billing.recipient.bounced', targetType: 'BillingAccount', targetId: row.accountId,
            requestId: row.attemptId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attemptId: row.attemptId, kind: attempt.errorCode ?? 'suppressed' } } });
          const latest = await latestPackageInvoice(tx, { billingAccountId: row.accountId, applyStatus: 'APPLIED', appliedAt: { not: null } });
          if (!latest) return;
          const managers = await this.planManagers(row.companyId, tx);
          await this.events.executeInTransaction({ companyId: row.companyId, triggerKey: 'billing.package_updated', sourceModule: 'billing', sourceType: 'invoice',
            sourceId: latest.id, periodKey: `recipient-bounce:${row.accountId}:${bouncedAt.toISOString()}`, severity: 'action', title: 'อีเมลรับเอกสารส่งไม่ถึง',
            body: 'อีเมลรับเอกสารการชำระเงินของบริษัทส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารในหน้าแพ็กเกจ',
            deepLinkHref: `/companies/${encodeURIComponent(row.companyId)}/billing`, recipientUserIds: managers.map(m => m.userId) }, tx);
          await tx.billingAccount.update({ where: { id: row.accountId }, data: { recipientBounceNotifiedAt: new Date() } });
        });
      } catch {
        // The row stays due and the next drain retries it; the issue keeps a persistent failure visible.
        await this.billing.issue(row.companyId, 'NOTIFICATION_REVIEW', row.attemptId);
      }
    }
  }

  private billingHref(companyId: string) {
    let origin: URL;
    try { origin = new URL(this.config.sesWebBaseUrl ?? ''); } catch { throw new PostmarkSendError('CONFIG', 'invalid_web_origin'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw new PostmarkSendError('CONFIG', 'invalid_web_origin');
    return new URL(`/companies/${encodeURIComponent(companyId)}/billing`, origin).toString();
  }

  private async drainDeliveries() {
    // Reuse NotificationDelivery metadata as the durable LINE journal. A five-minute
    // SENDING lease outlives the provider timeout; recovery keeps the first retry key.
    const due = await this.prisma.client.$queryRaw<Array<{ id: string; companyId: string }>>`
      SELECT d.id, d."companyId" FROM "NotificationDelivery" d
      JOIN "NotificationRecipient" r ON r.id = d."recipientId" AND r."companyId" = d."companyId"
      JOIN "NotificationEvent" e ON e.id = r."eventId" AND e."companyId" = d."companyId"
      JOIN "BillingInvoice" i ON e."sourceModule" = 'billing' AND e."sourceType" = 'invoice' AND e."sourceId" = i.id
      JOIN "BillingAccount" a ON a.id = i."billingAccountId" AND a."companyId" = d."companyId"
      WHERE a."stripeAccountId" = ${this.billing.stripe.accountId} AND a.livemode = ${this.billing.stripe.livemode}
        AND ((d.status = 'QUEUED' AND (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= now()))
          OR (d.status IN ('SENDING', 'FAILED') AND d."nextAttemptAt" <= now()))
      ORDER BY d."createdAt", d.id LIMIT 20`;
    let processed = 0, failed = 0;
    for (const row of due) {
      try { await this.deliver(row.id, row.companyId); processed++; }
      catch {
        await this.billing.issue(row.companyId, 'NOTIFICATION_REVIEW', row.id);
        await this.prisma.client.notificationDelivery.updateMany({ where: { id: row.id, status: { in: ['QUEUED', 'FAILED'] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, data: { nextAttemptAt: new Date(Date.now() + 60000) } });
        failed++;
      }
    }
    return { processed, failed };
  }

  private async deliver(id: string, companyId: string) {
    const claimed = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, companyId);
      const row = await tx.notificationDelivery.findFirst({ where: { id, companyId }, include: { recipient: { include: { event: true } } } });
      if (!row || !['QUEUED', 'FAILED', 'SENDING'].includes(row.status) || (row.nextAttemptAt && row.nextAttemptAt > new Date()) ||
        (row.status !== 'QUEUED' && !row.nextAttemptAt)) return null;
      const event = row.recipient.event;
      if (event.sourceModule !== 'billing' || event.sourceType !== 'invoice' || !event.sourceId) return null;
      await this.invoiceSource(event.sourceId, companyId, tx);
      const finish = (status: 'SUPPRESSED' | 'SKIPPED' | 'FAILED', code: string) => tx.notificationDelivery.update({ where: { id },
        data: { status, nextAttemptAt: null, errorCode: code } }).then(() => ({ issue: code, id }));
      const retryOperationId=(row.metadataJson as {retryOperationId?:string}).retryOperationId;
      try{await this.retryAuthority(retryOperationId,companyId,id,tx);}catch{return finish('FAILED','CONTROL_PERMISSION_CHANGED');}
      if (event.status !== 'OPEN' || !(await this.planManagers(companyId, tx)).some(m => m.userId === row.recipient.userId)) {
        return finish('SUPPRESSED', 'RECIPIENT_OR_EVENT_INACTIVE');
      }
      if (row.channel === 'WEB') {
        await tx.notificationDelivery.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), nextAttemptAt: null,
          attemptCount: row.attemptCount + 1, errorCode: null } });
        return null;
      }
      const preference = await tx.notificationPreference.findUnique({ where: { companyId_userId: { companyId, userId: row.recipient.userId } } });
      const channels = Array.isArray(preference?.enabledChannelsJson) ? preference.enabledChannelsJson : DEFAULT_ENABLED_CHANNELS;
      const triggers = Array.isArray(preference?.enabledTriggerKeysJson) ? preference.enabledTriggerKeysJson : IMPLEMENTED_TRIGGER_KEYS;
      if (!channels.includes('line') || !triggers.includes(event.triggerKey)) return finish('SUPPRESSED', 'PREFERENCE_SUPPRESSED');
      if (isInQuietHours(new Date(), preference?.quietHoursStart ?? undefined, preference?.quietHoursEnd ?? undefined, preference?.timezone ?? 'Asia/Bangkok')) {
        await tx.notificationDelivery.update({ where: { id }, data: { status: 'QUEUED', nextAttemptAt: new Date(Date.now() + 1800000), errorCode: 'QUIET_HOURS' } });
        return null;
      }
      const channelId = this.config.lineMessagingChannelId, token = (await this.lineCredentials.get(tx)).accessToken;
      if (!channelId || !token) return finish('SKIPPED', 'LINE_CONFIGURATION_MISSING');
      const identity = await tx.externalIdentity.findFirst({ where: { userId: row.recipient.userId, provider: 'LINE', providerChannelId: channelId, status: 'ACTIVE' } });
      if (!identity) return finish('SKIPPED', 'NO_LINE_DELIVERY_TARGET');
      const message = buildLineMessage({ companyId, title: event.title, body: event.body, severity: event.severity.toLowerCase(), deepLinkHref: this.billingHref(companyId) });
      const binding = createHash('sha256').update(JSON.stringify({ channelId, to: identity.providerUserId, message })).digest('hex');
      const retryBinding=(row.metadataJson as {retryBinding?:string}).retryBinding;
      if(retryOperationId&&retryBinding!==binding)return finish('FAILED','LINE_BINDING_CHANGED');
      const previous = (row.metadataJson as { billing?: { binding?: string; firstStartedAt?: string } }).billing;
      if (previous && (previous.binding !== binding || !previous.firstStartedAt || !Number.isFinite(Date.parse(previous.firstStartedAt)))) return finish('FAILED', 'LINE_BINDING_CHANGED');
      if (previous && Date.now() - Date.parse(previous.firstStartedAt!) >= 23 * 3600000) return finish('FAILED', 'LINE_UNKNOWN_REVIEW');
      if (row.attemptCount >= MAX_DELIVERY_ATTEMPTS) return finish('FAILED', 'LINE_RETRY_EXHAUSTED');
      const claimToken = randomUUID(), firstStartedAt = previous?.firstStartedAt ?? new Date().toISOString();
      const changed = await tx.notificationDelivery.updateMany({ where: { id, status: row.status, updatedAt: row.updatedAt }, data: {
        status: 'SENDING', attemptCount: row.attemptCount + 1, nextAttemptAt: new Date(Date.now() + 300000),
        metadataJson: { ...(row.metadataJson as Prisma.InputJsonObject), billing: { claimToken, binding, firstStartedAt, channelId } },
      } });
      return changed.count ? { id, invoiceId: event.sourceId, userId: row.recipient.userId, lineUserId: identity.providerUserId, channelId,
        token, message, claimToken, retryOperationId, attemptCount: row.attemptCount + 1 } : null;
    });
    if (!claimed) return;
    if ('issue' in claimed) {
      if (claimed.issue !== 'PREFERENCE_SUPPRESSED') await this.billing.issue(companyId, 'NOTIFICATION_REVIEW', id);
      return;
    }
    const fence = { id, companyId, status: 'SENDING' as const, metadataJson: { path: ['billing', 'claimToken'], equals: claimed.claimToken } };
    // Recheck immediately before network I/O, without holding a company/invoice lock.
    try {
      await this.retryAuthority(claimed.retryOperationId,companyId,id);
      await this.invoiceSource(claimed.invoiceId, companyId);
      const current = await this.prisma.client.notificationDelivery.findFirst({ where: { ...fence, nextAttemptAt: { gt: new Date() }, recipient: { event: { status: 'OPEN' } } } });
      const owner = (await this.planManagers(companyId)).some(m => m.userId === claimed.userId);
      const identity = await this.prisma.client.externalIdentity.findFirst({ where: { userId: claimed.userId, provider: 'LINE', status: 'ACTIVE',
        providerChannelId: claimed.channelId, providerUserId: claimed.lineUserId } });
      if (!current || !owner || !identity || this.config.lineMessagingChannelId !== claimed.channelId) throw new Error('billing.line_source_changed');
      const preference=await this.prisma.client.notificationPreference.findUnique({where:{companyId_userId:{companyId,userId:claimed.userId}}});
      const channels=Array.isArray(preference?.enabledChannelsJson)?preference.enabledChannelsJson:DEFAULT_ENABLED_CHANNELS;
      const triggers=Array.isArray(preference?.enabledTriggerKeysJson)?preference.enabledTriggerKeysJson:IMPLEMENTED_TRIGGER_KEYS;
      if(!channels.includes('line')||!triggers.includes('billing.package_updated')||isInQuietHours(new Date(),preference?.quietHoursStart??undefined,preference?.quietHoursEnd??undefined,preference?.timezone??'Asia/Bangkok'))throw new Error('billing.line_preference_changed');
    } catch (error) {
      const denied=error instanceof Error&&error.message==='CONTROL_PERMISSION_CHANGED';
      await this.prisma.client.notificationDelivery.updateMany({ where: fence, data: { status: denied?'FAILED':'QUEUED', nextAttemptAt: denied?null:new Date(Date.now() + 60000), errorCode: denied?'CONTROL_PERMISSION_CHANGED':'LINE_SEND_NOT_STARTED' } });
      throw error;
    }
    const result = await pushLineMessage(claimed.token, claimed.lineUserId, claimed.message, id), now = new Date();
    const outcome = resolveDeliveryOutcome({ resultStatus: result.status, errorCode: result.errorCode, attemptCountAfter: claimed.attemptCount,
      maxAttempts: MAX_DELIVERY_ATTEMPTS, now });
    const settled = await this.prisma.client.$transaction(async tx=>{
      const changed=await tx.notificationDelivery.updateMany({ where: fence, data: {
        status: outcome.status.toUpperCase() as 'SENT' | 'FAILED' | 'QUEUED', nextAttemptAt: outcome.nextAttemptAt ?? null,
        sentAt: result.status === 'sent' ? now : null, providerMessageId: result.providerMessageId ?? null, errorCode: result.errorCode ?? null,
      } });
      if(changed.count&&result.status==='sent')await resolveBillingIssue(tx,{companyId,stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,kind:'NOTIFICATION_REVIEW',referenceId:id},'LINE_REQUEST_ACCEPTED');
      return changed;
    });
    if (settled.count && result.status !== 'sent') await this.billing.issue(companyId, 'NOTIFICATION_REVIEW', id);
  }
}
