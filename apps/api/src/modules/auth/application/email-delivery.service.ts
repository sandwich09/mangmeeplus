import { assertNotDemoCompany, assertNotDemoEmailRecipient } from '../../sales-demo/application/demo-company-access';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { EmailSendAttempt, Prisma } from '../../../generated/prisma/client';
import { PostmarkClient, PostmarkSendError, validPostmarkMessageId } from '../infrastructure/postmark.client';

import { maintainEmailHistory } from './email-history-retention';

export const POSTMARK_EVENT_TYPE = 'email.postmark.event.received';
const RETRY_MINUTES = [1, 5, 15, 60];
function recoveryAt(generation: number, minimumSeconds = 60): Date {
  const seconds = (RETRY_MINUTES[Math.min(generation - 1, 3)] ?? 60) * 60;
  return new Date(Date.now() + Math.max(minimumSeconds, seconds * (1 + Math.random() * 0.2)) * 1000);
}
export type PreparedMail = { companyId?: string; purpose: string; recipient: string; signupRequestId?: string; deadlineAt?: Date; intentKey?: string };

@Injectable()
export class EmailDeliveryService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService, private readonly postmark: PostmarkClient) {}

  async maintainHistory() {
    return maintainEmailHistory(this.prisma, this.config.postmarkServerId, this.config.postmarkMessageStream);
  }

  get isPostmark(): boolean { return this.config.emailProvider === 'postmark'; }

  async prepare(input: PreparedMail, transaction?: Prisma.TransactionClient): Promise<EmailSendAttempt> {
    const run = async (tx: Prisma.TransactionClient) => {
      if (input.companyId) await assertNotDemoCompany(tx, input.companyId);
      await assertNotDemoEmailRecipient(tx, input.recipient);
      const recipient = input.recipient.trim().toLowerCase();
      const serverId = this.config.postmarkServerId;
      if (!serverId) throw new PostmarkSendError('CONFIG', 'missing_server_id');
      if (input.signupRequestId) {
        // Same transaction lock as CompanySignupCoreService, including legacy SES callbacks.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.signupRequestId}, 0))`;
        await tx.$queryRaw`SELECT id FROM "CompanySignupRequest" WHERE id = ${input.signupRequestId} FOR UPDATE`;
        const request = await tx.companySignupRequest.findUnique({ where: { id: input.signupRequestId } });
        if (!request || request.state !== 'EMAIL_PENDING' || request.contactEmail?.toLowerCase() !== recipient) {
          throw new PostmarkSendError('PERMANENT', 'claim_state_changed');
        }
        if (request.latestClaimEmailAttemptId) {
          const active = await tx.emailSendAttempt.findUnique({ where: { id: request.latestClaimEmailAttemptId } });
          if (active && ['SENDING', 'UNKNOWN'].includes(active.status)) throw new PostmarkSendError('UNKNOWN', 'pending_reconciliation');
        }
      }
      const suppressed = await tx.emailSuppression.findUnique({ where: {
        providerServerId_stream_recipient: { providerServerId: serverId, stream: this.config.postmarkMessageStream, recipient },
      } });
      if (suppressed) throw new PostmarkSendError('SUPPRESSED', 'inactive_recipient');
      const intentKey = input.intentKey ?? `mail:${randomUUID()}`;
      const previous = await tx.emailSendAttempt.findFirst({ where: { intentKey }, orderBy: { generation: 'desc' } });
      if (previous) {
        if (previous.provider !== 'postmark' || previous.providerServerId !== serverId || previous.stream !== this.config.postmarkMessageStream ||
            (previous.companyId !== null && previous.companyId !== (input.companyId ?? null)) || previous.purpose !== input.purpose || previous.recipient !== recipient || previous.signupRequestId !== (input.signupRequestId ?? null)) {
          throw new PostmarkSendError('PERMANENT', 'intent_binding_mismatch');
        }
        if (['READY', 'SENDING', 'UNKNOWN'].includes(previous.status)) throw new PostmarkSendError('UNKNOWN', 'pending_reconciliation');
        if (previous.status === 'ACCEPTED' || previous.deliveredAt) return previous;
        if (['CONFIG', 'PERMANENT', 'SUPPRESSED'].includes(previous.status) || previous.generation >= 5) {
          throw new PostmarkSendError('PERMANENT', 'recovery_required');
        }
        if (previous.deadlineAt && previous.deadlineAt <= new Date()) throw new PostmarkSendError('PERMANENT', 'proof_expired');
        if (previous.nextRecoveryAt && previous.nextRecoveryAt > new Date()) {
          throw new PostmarkSendError('RETRY', 'backoff', Math.ceil((previous.nextRecoveryAt.getTime() - Date.now()) / 1000));
        }
      }
      if (input.deadlineAt && input.deadlineAt <= new Date()) throw new PostmarkSendError('PERMANENT', 'proof_expired');
      const attempt = await tx.emailSendAttempt.create({ data: {
        id: randomUUID(), intentKey, generation: (previous?.generation ?? 0) + 1,
        companyId: input.companyId, purpose: input.purpose, signupRequestId: input.signupRequestId, deadlineAt: previous?.deadlineAt ?? input.deadlineAt,
        possibleDuplicate: previous?.possibleDuplicate || previous?.errorCode === 'delivery_unconfirmed_possible_duplicate',
        provider: 'postmark', providerServerId: serverId, stream: this.config.postmarkMessageStream, recipient,
        nextRecoveryAt: new Date(Date.now() + 60_000),
      } });
      if (input.signupRequestId) await tx.companySignupRequest.update({
        where: { id: input.signupRequestId }, data: { latestClaimEmailAttemptId: attempt.id },
      });
      return attempt;
    };
    return transaction ? run(transaction) : this.prisma.client.$transaction(run);
  }

  async prepareReviewedBilling(input:{companyId?:string;intentKey:string;recipient:string;expectedLatestId:string|null},tx:Prisma.TransactionClient) {
    if (input.companyId) await assertNotDemoCompany(tx, input.companyId);
    await assertNotDemoEmailRecipient(tx, input.recipient);
    const recipient=input.recipient.trim().toLowerCase(),serverId=this.config.postmarkServerId,stream=this.config.postmarkMessageStream;
    if(!this.isPostmark||!serverId||!stream||!input.intentKey.startsWith('billing-notice:'))throw new PostmarkSendError('CONFIG','mail_provider_unavailable');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.intentKey},0))`;
    const attempts=await tx.emailSendAttempt.findMany({where:{intentKey:input.intentKey},orderBy:{generation:'desc'},take:6}),previous=attempts[0];
    if((previous?.id??null)!==input.expectedLatestId)throw new PostmarkSendError('PERMANENT','recovery_source_changed');
    if(attempts.some(a=>a.provider!=='postmark'||a.providerServerId!==serverId||a.stream!==stream||(a.companyId!==null&&a.companyId!==(input.companyId??null))||a.purpose!=='billing_status'||a.recipient!==recipient||a.signupRequestId))throw new PostmarkSendError('PERMANENT','intent_binding_mismatch');
    if(attempts.some(a=>a.status==='ACCEPTED'||a.deliveredAt||a.providerMessageId))throw new PostmarkSendError('PERMANENT','prior_generation_accepted');
    if(attempts.some(a=>a.status==='SUPPRESSED'||a.suppressedAt)||await tx.emailSuppression.findUnique({where:{providerServerId_stream_recipient:{providerServerId:serverId,stream,recipient}}}))throw new PostmarkSendError('SUPPRESSED','inactive_recipient');
    if(previous?.deadlineAt&&previous.deadlineAt<=new Date())throw new PostmarkSendError('PERMANENT','proof_expired');
    if(previous?.status==='READY'&&!previous.dispatchStartedAt)return previous;
    if(previous&&['SENDING','UNKNOWN'].includes(previous.status))throw new PostmarkSendError('UNKNOWN','pending_reconciliation');
    if(previous&&(!['CONFIG','PERMANENT','RETRY'].includes(previous.status)||previous.generation>=5))throw new PostmarkSendError('PERMANENT','recovery_required');
    if(previous?.nextRecoveryAt&&previous.nextRecoveryAt>new Date())throw new PostmarkSendError('RETRY','backoff');
    return tx.emailSendAttempt.create({data:{id:randomUUID(),intentKey:input.intentKey,generation:(previous?.generation??0)+1,companyId:input.companyId,purpose:'billing_status',recipient,
      provider:'postmark',providerServerId:serverId,stream,status:'READY',deadlineAt:previous?.deadlineAt,
      possibleDuplicate:previous?.possibleDuplicate||previous?.errorCode==='delivery_unconfirmed_possible_duplicate'}});
  }

  async send(attempt: EmailSendAttempt, content: { subject: string; html: string; text: string }, beforeDispatch?: () => Promise<void>): Promise<string> {
    const current = await this.prisma.client.emailSendAttempt.findUnique({ where: { id: attempt.id } });
    if (current?.companyId) await assertNotDemoCompany(this.prisma.client, current.companyId);
    await assertNotDemoEmailRecipient(this.prisma.client, current?.recipient ?? attempt.recipient);
    if (current?.status === 'ACCEPTED' && current.providerMessageId) return current.providerMessageId;
    if (!current || !['READY','SENDING'].includes(current.status) || current.suppressedAt) throw new PostmarkSendError('PERMANENT', 'attempt_not_sendable');
    if (current.dispatchStartedAt) throw new PostmarkSendError('UNKNOWN', 'pending_reconciliation');
    let dispatchStartedAt: Date | null = null;
    try {
      if(await this.prisma.client.emailSendAttempt.findFirst({where:{intentKey:current.intentKey,id:{not:current.id},OR:[{status:'ACCEPTED'},{deliveredAt:{not:null}},{providerMessageId:{not:null}}]}}))throw new PostmarkSendError('PERMANENT','prior_generation_accepted');
      if (current.deadlineAt && current.deadlineAt <= new Date()) throw new PostmarkSendError('PERMANENT', 'proof_expired');
      const suppressed = await this.prisma.client.emailSuppression.findUnique({ where: { providerServerId_stream_recipient: {
        providerServerId: current.providerServerId, stream: current.stream, recipient: current.recipient,
      } } });
      if (suppressed) throw new PostmarkSendError('SUPPRESSED', 'inactive_recipient');
      const startedAt = new Date();
      const claimed = await this.prisma.client.emailSendAttempt.updateMany({
        where: { id: current.id, status: current.status, dispatchStartedAt: null, suppressedAt: null },
        data: { status:'SENDING',dispatchStartedAt: startedAt, nextRecoveryAt: new Date(startedAt.getTime() + 60_000) },
      });
      if (!claimed.count) throw new PostmarkSendError('UNKNOWN', 'pending_reconciliation');
      dispatchStartedAt = startedAt;
      const result = await this.postmark.send({
        From: `${this.config.postmarkFromName} <${this.config.postmarkFromAddress}>`, To: current.recipient,
        Subject: content.subject, TextBody: content.text, HtmlBody: content.html,
        MessageStream: current.stream, TrackOpens: false, TrackLinks: 'None', Tag: current.purpose,
        Metadata: { sendAttemptId: current.id },
      }, beforeDispatch);
      await this.prisma.client.$transaction(async (tx) => {
        // A callback may already have bound this ID or suppressed the message. Never erase it.
        const latest = await tx.emailSendAttempt.findUnique({ where: { id: attempt.id } });
        if (latest?.providerMessageId && latest.providerMessageId !== result.messageId) throw new PostmarkSendError('UNKNOWN', 'message_binding_mismatch');
        await tx.emailSendAttempt.updateMany({
          where: { id: attempt.id, status: { in: ['SENDING', 'UNKNOWN'] }, suppressedAt: null },
          data: { status: 'ACCEPTED', providerMessageId: result.messageId, submittedAt: result.submittedAt, nextRecoveryAt: null },
        });
        if (attempt.signupRequestId) await tx.companySignupRequest.updateMany({
          where: { id: attempt.signupRequestId, latestClaimEmailAttemptId: attempt.id, state: 'EMAIL_PENDING' },
          data: { claimEmailLastSentAt: result.submittedAt },
        });
      });
      return result.messageId;
    } catch (error) {
      const failure = error instanceof PostmarkSendError ? error : new PostmarkSendError('UNKNOWN', 'result_persistence');
      if (failure.code === 'pending_reconciliation') throw failure;
      await this.prisma.client.$transaction(async (tx) => {
        await tx.emailSendAttempt.updateMany({ where: { id: attempt.id, status: dispatchStartedAt?'SENDING':current.status, dispatchStartedAt }, data: {
          status: failure.kind, errorCode: failure.code,
          nextRecoveryAt: ['UNKNOWN', 'RETRY'].includes(failure.kind) ? recoveryAt(attempt.generation, failure.retryAfterSeconds) : null,
        } });
        if (failure.kind === 'SUPPRESSED') await this.suppress(tx, attempt, failure.code);
      });
      throw failure;
    }
  }

  async suppress(tx: Prisma.TransactionClient, attempt: Pick<EmailSendAttempt, 'providerServerId' | 'stream' | 'recipient'>, reason: string) {
    const scope = { providerServerId: attempt.providerServerId, stream: attempt.stream, recipient: attempt.recipient };
    await tx.emailSuppression.upsert({ where: { providerServerId_stream_recipient: scope }, create: { ...scope, reason }, update: { reason } });
  }

  async reconcileUnknown(attemptId?:string): Promise<number> {
    const due = await this.prisma.client.emailSendAttempt.findMany({
      where: { provider: 'postmark', providerServerId: this.config.postmarkServerId, stream: this.config.postmarkMessageStream,
        status: { in: ['UNKNOWN', 'SENDING'] }, nextRecoveryAt: { lte: new Date() },...attemptId?{id:attemptId}:{} }, take: attemptId?1:20, orderBy: { createdAt: 'asc' },
    });
    let reconciled = 0;
    for (const attempt of due) {
      try {
        const results = await this.postmark.findAttempt(attempt.id, attempt.stream);
        const matches = results.filter((r) => validPostmarkMessageId(r.MessageID) && r.MessageStream === attempt.stream &&
          r.Metadata?.sendAttemptId === attempt.id && Array.isArray(r.Recipients) && r.Recipients.length === 1 &&
          typeof r.Recipients[0] === 'string' && r.Recipients[0].toLowerCase() === attempt.recipient &&
          typeof r.ReceivedAt === 'string' && Number.isFinite(Date.parse(r.ReceivedAt)));
        if (matches.length !== 1 || results.length !== 1) {
          // Empty lookup cannot prove non-delivery. A bounded retry is recorded as possibly duplicate.
          await this.prisma.client.emailSendAttempt.updateMany({ where: { id: attempt.id, status: { in: ['UNKNOWN', 'SENDING'] } },
            data: { status: results.length ? 'UNKNOWN' : 'RETRY', errorCode: results.length ? 'ambiguous_delivery' : 'delivery_unconfirmed_possible_duplicate',
              nextRecoveryAt: recoveryAt(attempt.generation) } });
          continue;
        }
        const message = matches[0]!;
        await this.prisma.client.$transaction(async (tx) => {
          const submittedAt = new Date(message.ReceivedAt);
          const changed = await tx.emailSendAttempt.updateMany({ where: { id: attempt.id, status: { in: ['UNKNOWN', 'SENDING'] }, suppressedAt: null,
            OR: [{ providerMessageId: null }, { providerMessageId: message.MessageID }] },
            data: { status: 'ACCEPTED', providerMessageId: message.MessageID, submittedAt, nextRecoveryAt: null } });
          if (changed.count && attempt.signupRequestId) await tx.companySignupRequest.updateMany({
            where: { id: attempt.signupRequestId, state: 'EMAIL_PENDING', latestClaimEmailAttemptId: attempt.id }, data: { claimEmailLastSentAt: submittedAt },
          });
        });
        reconciled += 1;
      } catch {
        // Failed lookups go to the back of the queue so an old failure cannot starve newer attempts.
        await this.prisma.client.emailSendAttempt.updateMany({ where: { id: attempt.id, status: { in: ['UNKNOWN', 'SENDING'] } },
          data: { nextRecoveryAt: recoveryAt(attempt.generation) } });
      }
    }
    return reconciled;
  }
}
